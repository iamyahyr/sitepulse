import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { computeObservedUptime, type Interval } from "@sitepulse/core";
import {
  and,
  asc,
  checkRollupsHourly,
  desc,
  eq,
  gt,
  gte,
  inArray,
  incidents,
  isNull,
  lt,
  or,
  reportShares,
  sites,
  sql,
} from "@sitepulse/db";
import type { LatencyPoint } from "@/components/latency-chart";
import { parseMonth, previousMonth, type Month } from "@/lib/months";
import { db } from "@/server/db";
import { isUuid } from "@/server/dal/ids";
import { closedManually, openingStatus } from "@/server/dal/incidents";

const DAY = 86_400_000;

type Rollup = typeof checkRollupsHourly.$inferSelect;
type Window = { from: Date; to: Date };

export type ReportDay = { day: Date; ratio: number | null };

export type ReportSite = {
  id: string;
  name: string;
  host: string;
  uptime: number | null;
  downtimeMs: number;
  incidents: number;
  checks: number;
  failedChecks: number;
  p50Ms: number | null;
  p95Ms: number | null;
  days: ReportDay[];
};

export type ReportIncident = {
  id: string;
  siteName: string;
  startedAt: Date;
  resolvedAt: Date | null;
  causeCode: string;
  httpStatus: number | null;
  closedManually: boolean;
};

export type ReportTotals = {
  uptime: number | null;
  downtimeMs: number;
  incidents: number;
  meanRecoveryMs: number | null;
  checks: number;
  p50Ms: number | null;
};

export type MonthlyReport = {
  client: string | null;
  month: Month;
  /** End of the reported data: the month's end, or now for the current month. */
  to: Date;
  sites: ReportSite[];
  totals: ReportTotals;
  previous: ReportTotals | null;
  incidents: ReportIncident[];
  /** Typical latency per phase, one point per day, across all of the client's sites. */
  latency: LatencyPoint[];
};

/** Distinct `client` values of the owner's sites, null ("No client") last. */
export async function listClients(ownerId: string): Promise<(string | null)[]> {
  const rows = await db()
    .selectDistinct({ client: sites.client })
    .from(sites)
    .where(eq(sites.ownerId, ownerId))
    .orderBy(sql`${sites.client} asc nulls last`);
  return rows.map((r) => r.client);
}

/**
 * One client's month: uptime, incidents and latency per site, plus the same
 * headline numbers for the month before. Built from the hourly rollups (kept
 * for months, unlike raw checks), so percentiles are approximate: the median
 * of the hourly percentiles, weighted by successful checks.
 */
export async function getMonthlyReport(
  ownerId: string,
  client: string | null,
  month: Month,
  now = new Date(),
): Promise<MonthlyReport> {
  const window: Window = { from: month.from, to: new Date(Math.min(month.to.getTime(), now.getTime())) };
  const before = previousMonth(month);

  const siteRows = await db()
    .select({ id: sites.id, name: sites.name, url: sites.url })
    .from(sites)
    .where(and(eq(sites.ownerId, ownerId), client === null ? isNull(sites.client) : eq(sites.client, client)))
    .orderBy(sites.name);
  const ids = siteRows.map((s) => s.id);
  if (ids.length === 0) {
    return { client, month, to: window.to, sites: [], totals: totalsOf([], [], window), previous: null, incidents: [], latency: [] };
  }

  const [rollups, incidentRows] = await Promise.all([
    db()
      .select()
      .from(checkRollupsHourly)
      .where(
        and(
          inArray(checkRollupsHourly.siteId, ids),
          gte(checkRollupsHourly.hour, before.from),
          lt(checkRollupsHourly.hour, window.to),
        ),
      )
      .orderBy(asc(checkRollupsHourly.hour)),
    db()
      .select({ incident: incidents, closedManually, openingStatus })
      .from(incidents)
      // The join also makes drizzle qualify every column, which the correlated subqueries above need.
      .innerJoin(sites, eq(sites.id, incidents.siteId))
      .where(
        and(
          eq(sites.ownerId, ownerId),
          inArray(incidents.siteId, ids),
          lt(incidents.startedAt, window.to),
          or(isNull(incidents.resolvedAt), gt(incidents.resolvedAt, before.from)),
        ),
      )
      .orderBy(asc(incidents.startedAt)),
  ]);

  const rollupsBySite = groupBy(rollups, (r) => r.siteId);
  const downBySite = groupBy(incidentRows, (r) => r.incident.siteId);
  const intervalsOf = (siteId: string): Interval[] =>
    (downBySite.get(siteId) ?? []).map(({ incident }) => ({ start: incident.startedAt, end: incident.resolvedAt }));

  const days = Array.from({ length: Math.ceil((window.to.getTime() - window.from.getTime()) / DAY) }, (_, i) => {
    const from = new Date(window.from.getTime() + i * DAY);
    return { from, to: new Date(Math.min(from.getTime() + DAY, window.to.getTime())) };
  });

  const reportSites: ReportSite[] = siteRows.map((site) => {
    const rows = within(rollupsBySite.get(site.id) ?? [], window);
    const intervals = intervalsOf(site.id);
    const uptime = computeObservedUptime(intervals, observedHours(rows), window);
    const checks = rows.reduce((sum, r) => sum + r.total, 0);
    return {
      id: site.id,
      name: site.name,
      host: hostOf(site.url),
      uptime: uptime.ratio,
      downtimeMs: uptime.downtimeMs,
      incidents: startedIn(downBySite.get(site.id) ?? [], window).length,
      checks,
      failedChecks: checks - rows.reduce((sum, r) => sum + r.ok, 0),
      p50Ms: weightedMedian(rows.map((r) => [r.p50TotalMs, r.ok])),
      p95Ms: weightedMedian(rows.map((r) => [r.p95TotalMs, r.ok])),
      days: days.map((day) => ({
        day: day.from,
        ratio: computeObservedUptime(intervals, observedHours(within(rows, day)), day).ratio,
      })),
    };
  });

  const perSite = siteRows.map((site) => ({ rows: rollupsBySite.get(site.id) ?? [], intervals: intervalsOf(site.id) }));
  // Only a finished month compares fairly with the one before it.
  const previous = window.to >= month.to ? totalsOf(perSite, incidentRows, before) : null;

  const monthRows = within(rollups, window);
  const latency = days.flatMap((day) => {
    const rows = within(monthRows, day);
    if (rows.every((r) => r.ok === 0)) return [];
    const phase = (pick: (r: Rollup) => number | null) =>
      Math.round(weightedMedian(rows.map((r) => [pick(r), r.ok])) ?? 0);
    return [
      {
        t: day.from.getTime(),
        dns: phase((r) => r.p50DnsMs),
        connect: phase((r) => r.p50ConnectMs),
        tls: phase((r) => r.p50TlsMs),
        ttfb: phase((r) => r.p50TtfbMs),
        download: phase((r) => r.p50DownloadMs),
      },
    ];
  });

  const names = new Map(siteRows.map((s) => [s.id, s.name]));
  return {
    client,
    month,
    to: window.to,
    sites: reportSites,
    totals: totalsOf(perSite, incidentRows, window),
    previous: previous?.uptime == null ? null : previous,
    incidents: overlapping(incidentRows, window).map(({ incident, closedManually, openingStatus }) => ({
      id: incident.id,
      siteName: names.get(incident.siteId) ?? "",
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      causeCode: incident.causeCode,
      httpStatus: openingStatus,
      closedManually,
    })),
    latency,
  };
}

/** Headline numbers across sites: uptime is weighted by each site's observed time. */
function totalsOf(
  perSite: { rows: Rollup[]; intervals: Interval[] }[],
  incidentRows: { incident: typeof incidents.$inferSelect; closedManually: boolean }[],
  window: Window,
): ReportTotals {
  let observedMs = 0;
  let downtimeMs = 0;
  let checks = 0;
  for (const site of perSite) {
    const rows = within(site.rows, window);
    const uptime = computeObservedUptime(site.intervals, observedHours(rows), window);
    observedMs += uptime.observedMs;
    downtimeMs += uptime.downtimeMs;
    checks += rows.reduce((sum, r) => sum + r.total, 0);
  }

  // Counted in the month they started, so one crossing midnight on the 1st is not counted twice.
  const started = startedIn(incidentRows, window);
  // Only real recoveries count towards MTTR; manually closed incidents say nothing about it.
  const recoveries = started
    .filter(({ incident, closedManually }) => incident.resolvedAt && !closedManually)
    .map(({ incident }) => incident.resolvedAt!.getTime() - incident.startedAt.getTime());

  return {
    uptime: observedMs === 0 ? null : 1 - downtimeMs / observedMs,
    downtimeMs,
    incidents: started.length,
    meanRecoveryMs: recoveries.length ? recoveries.reduce((a, b) => a + b, 0) / recoveries.length : null,
    checks,
    p50Ms: weightedMedian(perSite.flatMap((s) => within(s.rows, window).map((r) => [r.p50TotalMs, r.ok] as const))),
  };
}

const within = <T extends { hour: Date }>(rows: T[], window: Window) =>
  rows.filter((r) => r.hour >= window.from && r.hour < window.to);

const observedHours = (rows: Rollup[]) => rows.filter((r) => r.total > 0).map((r) => r.hour);

const startedIn = <T extends { incident: { startedAt: Date } }>(rows: T[], window: Window) =>
  rows.filter(({ incident }) => incident.startedAt >= window.from && incident.startedAt < window.to);

const overlapping = <T extends { incident: { startedAt: Date; resolvedAt: Date | null } }>(rows: T[], window: Window) =>
  rows.filter(({ incident }) => incident.startedAt < window.to && (!incident.resolvedAt || incident.resolvedAt > window.from));

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

/** Median of `[value, weight]` pairs, ignoring missing values and zero weights. */
function weightedMedian(pairs: (readonly [number | null, number])[]): number | null {
  const valid = pairs.filter((p): p is readonly [number, number] => p[0] !== null && p[1] > 0).sort((a, b) => a[0] - b[0]);
  const half = valid.reduce((sum, [, w]) => sum + w, 0) / 2;
  let seen = 0;
  for (const [value, weight] of valid) {
    seen += weight;
    if (seen >= half) return value;
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ─── Share links ────────────────────────────────────────────────────────

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const sameClient = (client: string | null) => (client === null ? isNull(reportShares.client) : eq(reportShares.client, client));

/** Creates a public link and returns its token, which is not stored and cannot be shown again. */
export async function createShare(ownerId: string, client: string | null, month: Month): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db()
    .insert(reportShares)
    .values({ ownerId, client, month: month.from.toISOString().slice(0, 10), tokenHash: hashToken(token) });
  return token;
}

/** Active links to one client's month, newest first. */
export async function listShares(ownerId: string, client: string | null, month: Month) {
  return db()
    .select({ id: reportShares.id, createdAt: reportShares.createdAt })
    .from(reportShares)
    .where(
      and(
        eq(reportShares.ownerId, ownerId),
        sameClient(client),
        eq(reportShares.month, month.from.toISOString().slice(0, 10)),
        isNull(reportShares.revokedAt),
      ),
    )
    .orderBy(desc(reportShares.createdAt));
}

export async function revokeShare(ownerId: string, id: string): Promise<void> {
  if (!isUuid(id)) return;
  await db()
    .update(reportShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(reportShares.id, id), eq(reportShares.ownerId, ownerId), isNull(reportShares.revokedAt)));
}

/** The report behind a public link, or null if the token is unknown or revoked. */
export async function getSharedReport(token: string): Promise<MonthlyReport | null> {
  // Tokens are 43 base64url characters; anything else cannot match, so skip the query.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [share] = await db()
    .select()
    .from(reportShares)
    .where(and(eq(reportShares.tokenHash, hashToken(token)), isNull(reportShares.revokedAt)));
  const month = share && parseMonth(share.month.slice(0, 7));
  return share && month ? getMonthlyReport(share.ownerId, share.client, month) : null;
}
