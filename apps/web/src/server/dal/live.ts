import "server-only";
import { and, eq, incidents, notifications, siteDegradations, sites, sql, workerHeartbeats } from "@sitepulse/db";
import { WORKER_STALE_MS } from "@/lib/worker";
import { db } from "@/server/db";
import { isUuid } from "@/server/dal/ids";

/** Narrows the fingerprint to what a detail page shows; omitted, it covers all of the owner's sites. */
export type LiveScope = { site: string } | { incident: string };

/** Alerts are retried for minutes, not days: older ones no longer change. */
const ALERT_WINDOW_MS = 24 * 3_600_000;

/**
 * Cheap fingerprint of everything the read-only pages show, polled by
 * <LiveRefresh /> so a page re-renders only when this changes.
 *
 * `sites.updated_at` moves on every recorded check (in the same transaction as
 * the site's state and its incidents) and on every edit made in the web app;
 * the worker leaves it alone when it merely claims or defers a site. Alert
 * deliveries and degradations are written separately, so they count on their
 * own. Heartbeats count only through "offline" and "stale", never
 * `last_seen_at` itself, so a heartbeat alone does not trigger a refresh.
 */
export async function liveFingerprint(ownerId: string, scope?: LiveScope): Promise<string> {
  const now = Date.now();
  const staleBefore = new Date(now - WORKER_STALE_MS).toISOString();
  const alertsSince = new Date(now - ALERT_WINDOW_MS).toISOString();

  const owned = eq(sites.ownerId, ownerId);
  const scoped = !scope
    ? owned
    : "site" in scope
      ? isUuid(scope.site)
        ? and(owned, eq(sites.id, scope.site))
        : sql`false`
      : isUuid(scope.incident)
        ? and(owned, sql`${sites.id} = (select ${incidents.siteId} from ${incidents} where ${incidents.id} = ${scope.incident})`)
        : sql`false`;
  const scopedSites = sql`select ${sites.id} from ${sites} where ${scoped}`;
  const latestHeartbeat = sql`from ${workerHeartbeats} order by ${workerHeartbeats.lastSeenAt} desc limit 1`;

  const [row] = await db()
    .select({
      sites: sql<string>`count(*)::text`,
      updatedAt: sql<string | null>`max(${sites.updatedAt})::text`,
      degradations: sql<string | null>`(
        select concat_ws('/', max(${siteDegradations.startedAt}), max(${siteDegradations.resolvedAt}))
        from ${siteDegradations} where ${siteDegradations.siteId} in (${scopedSites})
      )`,
      alerts: sql<string | null>`(
        select concat_ws('/', count(*), sum(${notifications.attempts}), count(*) filter (where ${notifications.status} = 'pending'))
        from ${notifications}
        where ${notifications.createdAt} > ${alertsSince}::timestamptz and (
          ${notifications.incidentId} in (select ${incidents.id} from ${incidents} where ${incidents.siteId} in (${scopedSites}))
          or ${notifications.degradationId} in (select ${siteDegradations.id} from ${siteDegradations} where ${siteDegradations.siteId} in (${scopedSites}))
        )
      )`,
      workerOffline: sql<string | null>`(select ${workerHeartbeats.offlineSince}::text ${latestHeartbeat})`,
      workerStale: sql<string | null>`(select (${workerHeartbeats.lastSeenAt} < ${staleBefore}::timestamptz)::text ${latestHeartbeat})`,
    })
    .from(sites)
    .where(scoped);

  return Object.values(row ?? {})
    .map((value) => value ?? "")
    .join("|");
}
