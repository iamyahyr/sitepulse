import "server-only";
import {
  alertChannels,
  and,
  asc,
  checks,
  count,
  desc,
  eq,
  gte,
  incidentEvents,
  incidents,
  isNotNull,
  isNull,
  lte,
  notifications,
  sites,
  sql,
} from "@sitepulse/db";
import { db } from "@/server/db";
import { isUuid } from "@/server/dal/ids";

/**
 * Incidents across all of an owner's sites. Every query joins through
 * `sites.owner_id`, so another account's incident id behaves like a missing one.
 */

export type Incident = typeof incidents.$inferSelect;
export type IncidentEvent = typeof incidentEvents.$inferSelect;
export type IncidentStatus = "open" | "resolved" | "all";

const DAY = 86_400_000;

/** Ended because monitoring was paused or the URL changed, rather than by a recovery. */
const closedManually = sql<boolean>`exists (
  select 1 from ${incidentEvents}
  where ${incidentEvents.incidentId} = ${incidents.id} and ${incidentEvents.type} = 'closed'
)`;

/**
 * HTTP status of the check that opened the incident, so a 502 reads "Bad
 * gateway" in lists too, not just "server error". Null once retention pruned it.
 */
const openingStatus = sql<number | null>`(
  select ${checks.httpStatus} from ${checks}
  where ${checks.siteId} = ${incidents.siteId} and not ${checks.success} and ${checks.checkedAt} >= ${incidents.startedAt}
  order by ${checks.checkedAt}
  limit 1
)`;

/** Keyset cursor "<startedAt ISO>_<id>": stable while new incidents keep arriving at the top. */
export type IncidentCursor = { startedAt: Date; id: string };

export function encodeCursor(incident: Pick<Incident, "startedAt" | "id">): string {
  return `${incident.startedAt.toISOString()}_${incident.id}`;
}

export function decodeCursor(raw: string | undefined): IncidentCursor | null {
  const [at, id] = raw?.split("_") ?? [];
  const startedAt = new Date(at ?? "");
  return id && isUuid(id) && !Number.isNaN(startedAt.getTime()) ? { startedAt, id } : null;
}

/** One page of incidents, newest first, plus whether older ones exist. */
export async function listIncidents(
  ownerId: string,
  filter: { status: IncidentStatus; siteId?: string; before?: IncidentCursor | null },
  limit = 50,
) {
  const conditions = [eq(sites.ownerId, ownerId)];
  if (filter.status === "open") conditions.push(isNull(incidents.resolvedAt));
  if (filter.status === "resolved") conditions.push(isNotNull(incidents.resolvedAt));
  if (filter.siteId && isUuid(filter.siteId)) conditions.push(eq(incidents.siteId, filter.siteId));
  if (filter.before) {
    conditions.push(
      sql`(${incidents.startedAt}, ${incidents.id}) < (${filter.before.startedAt.toISOString()}::timestamptz, ${filter.before.id}::uuid)`,
    );
  }

  const rows = await db()
    .select({
      incident: incidents,
      site: { id: sites.id, name: sites.name },
      closedManually,
      openingStatus,
    })
    .from(incidents)
    .innerJoin(sites, eq(sites.id, incidents.siteId))
    .where(and(...conditions))
    .orderBy(desc(incidents.startedAt), desc(incidents.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { rows: page, next: rows.length > limit && last ? encodeCursor(last.incident) : null };
}

/** Headline numbers for the last `days` days: how often things break and how fast they come back. */
export async function incidentStats(ownerId: string, now: Date, days = 30) {
  const from = new Date(now.getTime() - days * DAY);
  const [row] = await db()
    .select({
      total: count(),
      open: sql<number>`count(*) filter (where ${incidents.resolvedAt} is null)`.mapWith(Number),
      // Only real recoveries count towards MTTR; manually closed incidents say nothing about it.
      recoveredMs: sql<number | null>`avg(extract(epoch from (${incidents.resolvedAt} - ${incidents.startedAt})) * 1000)
        filter (where ${incidents.resolvedAt} is not null and not ${closedManually})`.mapWith(Number),
      downtimeMs: sql<number>`coalesce(sum(extract(epoch from (
        least(coalesce(${incidents.resolvedAt}, ${now.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz)
        - greatest(${incidents.startedAt}, ${from.toISOString()}::timestamptz)
      ))), 0) * 1000`.mapWith(Number),
    })
    .from(incidents)
    .innerJoin(sites, eq(sites.id, incidents.siteId))
    .where(
      and(
        eq(sites.ownerId, ownerId),
        sql`(${incidents.resolvedAt} is null or ${incidents.resolvedAt} > ${from.toISOString()}::timestamptz)`,
      ),
    );
  return {
    total: row?.total ?? 0,
    open: row?.open ?? 0,
    meanRecoveryMs: row?.recoveredMs || null,
    downtimeMs: row?.downtimeMs ?? 0,
  };
}

/** Failed checks of one cause, in order, while the incident lasted. */
export type CauseBreakdown = { errorCode: string; httpStatus: number | null; checks: number };

export async function getIncident(ownerId: string, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db()
    .select({ incident: incidents, site: sites, closedManually })
    .from(incidents)
    .innerJoin(sites, eq(sites.id, incidents.siteId))
    .where(and(eq(incidents.id, id), eq(sites.ownerId, ownerId)));
  if (!row) return null;

  const { incident } = row;
  const end = incident.resolvedAt ?? new Date();
  const during = and(
    eq(checks.siteId, incident.siteId),
    gte(checks.checkedAt, incident.startedAt),
    lte(checks.checkedAt, end),
  );

  const [events, failed, breakdown, recovery, alerts] = await Promise.all([
    db().select().from(incidentEvents).where(eq(incidentEvents.incidentId, id)).orderBy(asc(incidentEvents.at), asc(incidentEvents.id)),
    // The first two failures (when it started, when it was confirmed) and the latest one.
    Promise.all([
      db().select().from(checks).where(and(during, eq(checks.success, false))).orderBy(asc(checks.checkedAt)).limit(2),
      db().select().from(checks).where(and(during, eq(checks.success, false))).orderBy(desc(checks.checkedAt)).limit(1),
    ]),
    db()
      .select({ errorCode: sql<string>`coalesce(${checks.errorCode}, 'UNKNOWN')`, httpStatus: checks.httpStatus, checks: count() })
      .from(checks)
      .where(and(during, eq(checks.success, false)))
      .groupBy(sql`coalesce(${checks.errorCode}, 'UNKNOWN')`, checks.httpStatus)
      .orderBy(desc(count())),
    incident.resolvedAt
      ? db()
          .select()
          .from(checks)
          .where(and(eq(checks.siteId, incident.siteId), eq(checks.success, true), gte(checks.checkedAt, incident.resolvedAt)))
          .orderBy(asc(checks.checkedAt))
          .limit(1)
      : Promise.resolve([]),
    db()
      .select({
        id: notifications.id,
        kind: notifications.kind,
        status: notifications.status,
        attempts: notifications.attempts,
        sentAt: notifications.sentAt,
        lastError: notifications.lastError,
        createdAt: notifications.createdAt,
        channelName: alertChannels.name,
        channelType: alertChannels.type,
      })
      .from(notifications)
      .innerJoin(alertChannels, eq(alertChannels.id, notifications.channelId))
      .where(eq(notifications.incidentId, id))
      .orderBy(asc(notifications.createdAt)),
  ]);

  const [[firstFailed, confirming], [lastFailed]] = failed;
  return {
    ...row,
    events,
    firstFailed: firstFailed ?? null,
    confirming: confirming ?? null,
    lastFailed: lastFailed ?? null,
    breakdown: breakdown as CauseBreakdown[],
    recoveryCheck: recovery[0] ?? null,
    alerts,
  };
}
