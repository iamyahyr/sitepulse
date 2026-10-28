import { detectPhaseDegradation, isDegradationOver, median, PHASES, type Phase, type PhaseSamples } from "@sitepulse/core";
import {
  and,
  checkRollupsHourly,
  checks,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  notifications,
  siteAlertChannels,
  siteDegradations,
  sites,
  sql,
  type Database,
} from "@sitepulse/db";
import { log } from "./log";

/**
 * Periodic housekeeping, safe to run from several workers at once: every
 * step is idempotent (upserts, bounded deletes, unique "one open degradation
 * per site" index).
 *
 *   1. Roll raw checks up into hourly aggregates (feeds 7/30-day charts and
 *      the degradation baseline).
 *   2. Detect and resolve per-phase degradations.
 *   3. Delete raw checks past retention (the hourly rollups stay).
 */

export type MaintenanceOptions = {
  checkRetentionDays: number;
  rollupRetentionDays: number;
};

const HOUR = 3_600_000;
const BASELINE_DAYS = 7;
const DELETE_BATCH = 5_000;

/**
 * Aggregates completed hours. Each site restarts two hours before its latest
 * rollup, so checks recorded late (leases, deferred retries) are folded in.
 * Latency percentiles only use successful checks: a timeout is an outage, not
 * a slow response.
 */
export async function rollupHours(db: Database, now = new Date()): Promise<number> {
  const result = await db.execute(sql`
    insert into ${checkRollupsHourly} (
      site_id, hour, total, ok, p50_total_ms, p95_total_ms,
      p50_dns_ms, p50_connect_ms, p50_tls_ms, p50_ttfb_ms, p50_download_ms
    )
    select
      c.site_id,
      date_trunc('hour', c.checked_at, 'UTC') as hour,
      count(*),
      count(*) filter (where c.success),
      percentile_cont(0.5) within group (order by c.total_ms) filter (where c.success),
      percentile_cont(0.95) within group (order by c.total_ms) filter (where c.success),
      percentile_cont(0.5) within group (order by c.dns_ms) filter (where c.success and c.dns_ms is not null),
      percentile_cont(0.5) within group (order by c.connect_ms) filter (where c.success and c.connect_ms is not null),
      percentile_cont(0.5) within group (order by c.tls_ms) filter (where c.success and c.tls_ms is not null),
      percentile_cont(0.5) within group (order by c.ttfb_ms) filter (where c.success and c.ttfb_ms is not null),
      percentile_cont(0.5) within group (order by c.download_ms) filter (where c.success and c.download_ms is not null)
    from ${checks} c
    left join (
      select site_id, max(hour) as last_hour from ${checkRollupsHourly} group by site_id
    ) r on r.site_id = c.site_id
    where c.checked_at < date_trunc('hour', ${now.toISOString()}::timestamptz, 'UTC')
      and (r.last_hour is null or c.checked_at >= r.last_hour - interval '2 hours')
    group by c.site_id, date_trunc('hour', c.checked_at, 'UTC')
    on conflict (site_id, hour) do update set
      total = excluded.total,
      ok = excluded.ok,
      p50_total_ms = excluded.p50_total_ms,
      p95_total_ms = excluded.p95_total_ms,
      p50_dns_ms = excluded.p50_dns_ms,
      p50_connect_ms = excluded.p50_connect_ms,
      p50_tls_ms = excluded.p50_tls_ms,
      p50_ttfb_ms = excluded.p50_ttfb_ms,
      p50_download_ms = excluded.p50_download_ms
  `);
  return result.count ?? 0;
}

/** Deletes in small batches so a big backlog never holds long locks. */
async function deleteInBatches(db: Database, statement: () => ReturnType<typeof sql>): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(statement());
    const n = result.count ?? 0;
    total += n;
    if (n < DELETE_BATCH) return total;
  }
}

export async function pruneOldData(db: Database, options: MaintenanceOptions, now = new Date()) {
  const checksCutoff = new Date(now.getTime() - options.checkRetentionDays * 24 * HOUR);
  const rollupsCutoff = new Date(now.getTime() - options.rollupRetentionDays * 24 * HOUR);

  const checksDeleted = await deleteInBatches(
    db,
    () => sql`
      delete from ${checks} where id in (
        select id from ${checks} where checked_at < ${checksCutoff.toISOString()} limit ${DELETE_BATCH}
      )`,
  );
  const rollupsDeleted = await deleteInBatches(
    db,
    () => sql`
      delete from ${checkRollupsHourly} where (site_id, hour) in (
        select site_id, hour from ${checkRollupsHourly} where hour < ${rollupsCutoff.toISOString()} limit ${DELETE_BATCH}
      )`,
  );
  return { checksDeleted, rollupsDeleted };
}

/** Hourly p50 columns, one per phase. */
const ROLLUP_PHASE_COLUMNS = {
  dns: checkRollupsHourly.p50DnsMs,
  connect: checkRollupsHourly.p50ConnectMs,
  tls: checkRollupsHourly.p50TlsMs,
  ttfb: checkRollupsHourly.p50TtfbMs,
  download: checkRollupsHourly.p50DownloadMs,
};

function collect<T>(rows: T[], pick: (row: T, phase: Phase) => number | null): PhaseSamples {
  const samples: Partial<Record<Phase, number[]>> = {};
  for (const phase of PHASES) {
    samples[phase] = rows.map((row) => pick(row, phase)).filter((v): v is number => v !== null);
  }
  return samples;
}

function bySite<T extends { siteId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.siteId);
    if (list) list.push(row);
    else grouped.set(row.siteId, [row]);
  }
  return grouped;
}

export type DegradationEvent =
  | { type: "opened"; siteId: string; phase: Phase; baselineMs: number; recentMs: number }
  | { type: "resolved"; siteId: string; phase: Phase };

/**
 * Compares each healthy site's recent medians with its own 7-day baseline.
 * The recent window is at least an hour and at least four checks, so slow
 * check intervals still collect enough samples.
 */
export async function evaluateDegradations(db: Database, now = new Date()): Promise<DegradationEvent[]> {
  const events: DegradationEvent[] = [];

  // Down, paused or deleted sites: a degradation no longer means anything.
  const stale = await db
    .update(siteDegradations)
    .set({ resolvedAt: now })
    .where(
      and(
        isNull(siteDegradations.resolvedAt),
        sql`${siteDegradations.siteId} in (select id from ${sites} where not ${sites.enabled} or ${sites.state} = 'down')`,
      ),
    )
    .returning({ siteId: siteDegradations.siteId, phase: siteDegradations.phase });
  events.push(...stale.map((d) => ({ type: "resolved" as const, ...d })));

  const healthy = await db
    .select({ id: sites.id, intervalSec: sites.intervalSec, open: siteDegradations })
    .from(sites)
    .leftJoin(siteDegradations, and(eq(siteDegradations.siteId, sites.id), isNull(siteDegradations.resolvedAt)))
    .where(and(eq(sites.enabled, true), ne(sites.state, "down"), ne(sites.state, "unknown")));

  if (healthy.length === 0) return events;

  // Two queries for all sites instead of two per site: fetch the widest
  // window any site needs, then cut each site's own window in memory.
  const windows = new Map(
    healthy.map((site) => {
      const windowStart = new Date(now.getTime() - Math.max(HOUR, site.intervalSec * 4 * 1000));
      return [site.id, { windowStart, baselineStart: new Date(windowStart.getTime() - BASELINE_DAYS * 24 * HOUR) }];
    }),
  );
  const starts = [...windows.values()];
  const earliestWindow = new Date(Math.min(...starts.map((w) => w.windowStart.getTime())));
  const latestWindow = new Date(Math.max(...starts.map((w) => w.windowStart.getTime())));
  const earliestBaseline = new Date(Math.min(...starts.map((w) => w.baselineStart.getTime())));

  const recentRows = bySite(
    await db
      .select({
        siteId: checks.siteId,
        checkedAt: checks.checkedAt,
        dns: checks.dnsMs,
        connect: checks.connectMs,
        tls: checks.tlsMs,
        ttfb: checks.ttfbMs,
        download: checks.downloadMs,
      })
      .from(checks)
      .where(
        and(
          inArray(checks.siteId, healthy.map((s) => s.id)),
          eq(checks.success, true),
          gte(checks.checkedAt, earliestWindow),
        ),
      ),
  );

  const needBaseline = healthy.filter((s) => !s.open).map((s) => s.id);
  const baselineRows = bySite(
    needBaseline.length === 0
      ? []
      : await db
          .select({ siteId: checkRollupsHourly.siteId, hour: checkRollupsHourly.hour, ...ROLLUP_PHASE_COLUMNS })
          .from(checkRollupsHourly)
          .where(
            and(
              inArray(checkRollupsHourly.siteId, needBaseline),
              gte(checkRollupsHourly.hour, earliestBaseline),
              lt(checkRollupsHourly.hour, latestWindow),
            ),
          ),
  );

  for (const site of healthy) {
    const { windowStart, baselineStart } = windows.get(site.id)!;
    const recent = collect(
      (recentRows.get(site.id) ?? []).filter((row) => row.checkedAt >= windowStart),
      (row, phase) => row[phase],
    );

    if (site.open) {
      const current = median(recent[site.open.phase] ?? []);
      if (isDegradationOver(current, site.open.baselineMs)) {
        await db.update(siteDegradations).set({ resolvedAt: now }).where(eq(siteDegradations.id, site.open.id));
        events.push({ type: "resolved", siteId: site.id, phase: site.open.phase });
      } else if (current !== null && current > site.open.peakMs) {
        await db.update(siteDegradations).set({ peakMs: current }).where(eq(siteDegradations.id, site.open.id));
      }
      continue;
    }

    const baseline = collect(
      (baselineRows.get(site.id) ?? []).filter((row) => row.hour >= baselineStart && row.hour < windowStart),
      (row, phase) => row[phase],
    );

    const found = detectPhaseDegradation(recent, baseline);
    if (!found) continue;

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(siteDegradations)
        .values({
          siteId: site.id,
          phase: found.phase,
          startedAt: now,
          baselineMs: found.baselineMedianMs,
          peakMs: found.recentMedianMs,
        })
        .onConflictDoNothing()
        .returning({ id: siteDegradations.id });
      if (!created) return; // Another worker got there first.

      const channels = await tx
        .select({ channelId: siteAlertChannels.channelId })
        .from(siteAlertChannels)
        .where(eq(siteAlertChannels.siteId, site.id));
      if (channels.length > 0) {
        await tx
          .insert(notifications)
          .values(channels.map(({ channelId }) => ({ degradationId: created.id, channelId, kind: "degraded" as const })))
          .onConflictDoNothing();
      }
      events.push({
        type: "opened",
        siteId: site.id,
        phase: found.phase,
        baselineMs: found.baselineMedianMs,
        recentMs: found.recentMedianMs,
      });
    });
  }

  return events;
}

export async function runMaintenance(db: Database, options: MaintenanceOptions, now = new Date()) {
  const rolled = await rollupHours(db, now);
  const degradations = await evaluateDegradations(db, now);
  const pruned = await pruneOldData(db, options, now);
  for (const event of degradations) {
    log(event.type === "opened" ? "warn" : "info", `degradation ${event.type}`, { ...event });
  }
  if (pruned.checksDeleted || pruned.rollupsDeleted) log("info", "old data pruned", pruned);
  return { rolled, degradations, ...pruned };
}
