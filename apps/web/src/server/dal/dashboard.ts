import "server-only";
import { computeUptime } from "@sitepulse/core";
import { and, checks, desc, eq, gt, inArray, incidents, isNull, or, sql, workerHeartbeats } from "@sitepulse/db";
import { db } from "@/server/db";
import { latestChecks, listSites, type Check, type Site } from "@/server/dal/sites";

const HOUR = 3_600_000;
export const BAR_HOURS = 48;

export type HourBucket = { total: number; failed: number };

export type DashboardSite = Site & {
  latest: Check | null;
  uptime7d: number | null;
  p50Ms: number | null;
  /** Oldest → newest, one per hour, ending with the current hour. */
  buckets: HourBucket[];
};

export type OpenIncident = {
  site: Site;
  incident: typeof incidents.$inferSelect;
  lastFailed: Check | null;
};

export async function getDashboard(ownerId: string) {
  const now = new Date();
  const siteRows = await listSites(ownerId);
  const ids = siteRows.map((s) => s.id);
  const [heartbeat] = await db()
    .select({ lastSeenAt: workerHeartbeats.lastSeenAt })
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.lastSeenAt))
    .limit(1);

  if (ids.length === 0) {
    return { now, sites: [] as DashboardSite[], openIncidents: [] as OpenIncident[], workerLastSeen: heartbeat?.lastSeenAt ?? null };
  }

  const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR);
  const currentHour = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const barStart = new Date(currentHour.getTime() - (BAR_HOURS - 1) * HOUR);

  const [latest, p50Rows, bucketRows, incidentRows] = await Promise.all([
    latestChecks(ids),
    db()
      .select({
        siteId: checks.siteId,
        p50: sql<number | null>`percentile_cont(0.5) within group (order by ${checks.totalMs})`.mapWith(Number),
      })
      .from(checks)
      .where(and(inArray(checks.siteId, ids), eq(checks.success, true), gt(checks.checkedAt, new Date(now.getTime() - 24 * HOUR))))
      .groupBy(checks.siteId),
    db()
      .select({
        siteId: checks.siteId,
        hour: sql<string>`date_trunc('hour', ${checks.checkedAt})`.as("hour"),
        total: sql<number>`count(*)`.mapWith(Number),
        failed: sql<number>`count(*) filter (where not ${checks.success})`.mapWith(Number),
      })
      .from(checks)
      .where(and(inArray(checks.siteId, ids), gt(checks.checkedAt, barStart)))
      .groupBy(checks.siteId, sql`hour`),
    db()
      .select()
      .from(incidents)
      .where(and(inArray(incidents.siteId, ids), or(isNull(incidents.resolvedAt), gt(incidents.resolvedAt, weekAgo)))),
  ]);

  const p50 = new Map(p50Rows.map((r) => [r.siteId, r.p50]));

  const sites: DashboardSite[] = siteRows.map((site) => {
    const buckets: HourBucket[] = Array.from({ length: BAR_HOURS }, () => ({ total: 0, failed: 0 }));
    for (const row of bucketRows) {
      if (row.siteId !== site.id) continue;
      const index = Math.round((new Date(row.hour).getTime() - barStart.getTime()) / HOUR);
      if (buckets[index]) buckets[index] = { total: row.total, failed: row.failed };
    }
    const siteIncidents = incidentRows
      .filter((i) => i.siteId === site.id)
      .map((i) => ({ start: i.startedAt, end: i.resolvedAt }));

    return {
      ...site,
      latest: latest.get(site.id) ?? null,
      uptime7d: site.lastCheckedAt ? computeUptime(siteIncidents, { from: weekAgo, to: now }, site.createdAt).ratio : null,
      p50Ms: p50.get(site.id) ?? null,
      buckets,
    };
  });

  const open = incidentRows.filter((i) => i.resolvedAt === null);
  const openIncidents: OpenIncident[] = await Promise.all(
    open.map(async (incident) => {
      const [lastFailed] = await db()
        .select()
        .from(checks)
        .where(and(eq(checks.siteId, incident.siteId), eq(checks.success, false)))
        .orderBy(desc(checks.checkedAt))
        .limit(1);
      return { site: siteRows.find((s) => s.id === incident.siteId)!, incident, lastFailed: lastFailed ?? null };
    }),
  );

  return { now, sites, openIncidents, workerLastSeen: heartbeat?.lastSeenAt ?? null };
}
