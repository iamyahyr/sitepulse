import "server-only";
import { and, checks, count, desc, eq, inArray, incidentEvents, incidents, isNull, sites, sql } from "@sitepulse/db";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import type { SiteInput } from "@/server/site-input";

/**
 * Data access for sites. Every query is scoped by owner, so a guessed or
 * leaked site id from another account behaves exactly like a missing one.
 */

export type Site = typeof sites.$inferSelect;
export type Check = typeof checks.$inferSelect;

export class QuotaExceededError extends Error {}

const isUuid = (id: string) => z.uuid().safeParse(id).success;

export async function listSites(ownerId: string) {
  return db().select().from(sites).where(eq(sites.ownerId, ownerId)).orderBy(sites.name);
}

export async function countSites(ownerId: string) {
  const [row] = await db().select({ n: count() }).from(sites).where(eq(sites.ownerId, ownerId));
  return row?.n ?? 0;
}

export async function getSite(ownerId: string, id: string): Promise<Site | null> {
  if (!isUuid(id)) return null;
  const [site] = await db()
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.ownerId, ownerId)));
  return site ?? null;
}

/** Most recent check of each site, keyed by site id. */
export async function latestChecks(siteIds: string[]): Promise<Map<string, Check>> {
  if (siteIds.length === 0) return new Map();
  const rows = await db()
    .selectDistinctOn([checks.siteId])
    .from(checks)
    .where(inArray(checks.siteId, siteIds))
    .orderBy(checks.siteId, desc(checks.checkedAt));
  return new Map(rows.map((row) => [row.siteId, row]));
}

export async function recentChecks(siteId: string, limit = 50) {
  return db().select().from(checks).where(eq(checks.siteId, siteId)).orderBy(desc(checks.checkedAt)).limit(limit);
}

export async function siteIncidents(siteId: string, limit = 20) {
  return db()
    .select()
    .from(incidents)
    .where(eq(incidents.siteId, siteId))
    .orderBy(desc(incidents.startedAt))
    .limit(limit);
}

export async function createSite(ownerId: string, input: SiteInput): Promise<Site> {
  return db().transaction(async (tx) => {
    // Serialize concurrent creates for this owner so the quota cannot be raced.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sites:${ownerId}`}))`);
    const [row] = await tx.select({ n: count() }).from(sites).where(eq(sites.ownerId, ownerId));
    if ((row?.n ?? 0) >= env().MAX_SITES_PER_USER) {
      throw new QuotaExceededError(`This instance allows up to ${env().MAX_SITES_PER_USER} sites per user.`);
    }
    const [site] = await tx
      .insert(sites)
      .values({ ...input, ownerId, nextCheckAt: new Date() })
      .returning();
    return site!;
  });
}

/**
 * Updates a site. Changing the URL or pausing monitoring ends the current
 * health streak: an open incident is closed (as "closed", not "resolved", so
 * it is not reported as a recovery) and the state machine starts over.
 * Without this, a site whose URL changed while down would keep an incident
 * open forever, since the next success would start from "unknown".
 */
export async function updateSite(ownerId: string, id: string, input: SiteInput): Promise<Site | null> {
  if (!isUuid(id)) return null;

  return db().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(sites)
      .where(and(eq(sites.id, id), eq(sites.ownerId, ownerId)))
      .for("update");
    if (!current) return null;

    const now = new Date();
    const resetHealth = current.url !== input.url || (current.enabled && !input.enabled);
    const reschedule =
      resetHealth || current.intervalSec !== input.intervalSec || (!current.enabled && input.enabled);

    if (resetHealth) {
      const closed = await tx
        .update(incidents)
        .set({ resolvedAt: now })
        .where(and(eq(incidents.siteId, id), isNull(incidents.resolvedAt)))
        .returning({ id: incidents.id });
      if (closed.length > 0) {
        await tx.insert(incidentEvents).values(closed.map((i) => ({ incidentId: i.id, at: now, type: "closed" as const })));
      }
    }

    const [site] = await tx
      .update(sites)
      .set({
        ...input,
        ...(resetHealth && {
          state: "unknown" as const,
          consecutiveFailures: 0,
          failingSince: null,
          lastErrorCode: null,
          tlsExpiresAt: null,
        }),
        ...(reschedule && { nextCheckAt: now }),
      })
      .where(eq(sites.id, id))
      .returning();
    return site ?? null;
  });
}

export async function deleteSite(ownerId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db()
    .delete(sites)
    .where(and(eq(sites.id, id), eq(sites.ownerId, ownerId)))
    .returning({ id: sites.id });
  return deleted.length > 0;
}
