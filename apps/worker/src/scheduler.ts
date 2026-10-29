import { and, eq, inArray, lte, sites, sql, type Database } from "@sitepulse/db";

/**
 * Rescheduling is bookkeeping, not a change anyone can see: keeping
 * `updated_at` as is stops the web app's live refresh from re-rendering for it.
 */
const keepUpdatedAt = { updatedAt: sql`${sites.updatedAt}` };

/**
 * Reschedules a claimed site without recording anything, e.g. when the
 * worker itself is offline. Ignored if the site was edited meanwhile (the
 * edit already rescheduled it).
 */
export async function deferSite(db: Database, site: ClaimedSite, until: Date): Promise<void> {
  await db
    .update(sites)
    .set({ nextCheckAt: until, ...keepUpdatedAt })
    .where(and(eq(sites.id, site.id), eq(sites.url, site.url)));
}

export type ClaimedSite = Pick<
  typeof sites.$inferSelect,
  "id" | "url" | "intervalSec" | "timeoutMs" | "expectedStatus"
>;

/** Extra time on top of the probe timeout before a claim is considered abandoned. */
const LEASE_GRACE_MS = 30_000;

/**
 * Claims up to `limit` due sites for this worker.
 *
 * `FOR UPDATE SKIP LOCKED` lets any number of workers poll the same table:
 * rows another worker is claiming are skipped instead of waited on. Claiming
 * pushes `next_check_at` forward by a lease, so the row stays out of every
 * worker's way while the probe runs *outside* the transaction (no row lock is
 * held during network I/O). If the worker dies mid-probe, the lease expires
 * and another worker picks the site up.
 */
export async function claimDueSites(db: Database, limit: number, now = new Date()): Promise<ClaimedSite[]> {
  if (limit <= 0) return [];

  return db.transaction(async (tx) => {
    const due = await tx
      .select({
        id: sites.id,
        url: sites.url,
        intervalSec: sites.intervalSec,
        timeoutMs: sites.timeoutMs,
        expectedStatus: sites.expectedStatus,
      })
      .from(sites)
      .where(and(eq(sites.enabled, true), lte(sites.nextCheckAt, now)))
      .orderBy(sites.nextCheckAt)
      .limit(limit)
      .for("update", { skipLocked: true });

    if (due.length === 0) return [];

    const leaseUntil = new Date(now.getTime() + Math.max(...due.map((s) => s.timeoutMs)) + LEASE_GRACE_MS);
    await tx
      .update(sites)
      .set({ nextCheckAt: leaseUntil, ...keepUpdatedAt })
      .where(inArray(sites.id, due.map((s) => s.id)));

    return due;
  });
}
