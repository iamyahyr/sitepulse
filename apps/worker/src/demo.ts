import {
  DEFAULT_TRANSITION_CONFIG,
  DEMO_SITES,
  INITIAL_HEALTH,
  demoBehaviour,
  transition,
  type ErrorCode,
  type SiteHealth,
} from "@sitepulse/core";
import { DEMO_USER, and, checks, eq, incidentEvents, incidents, sites, user, type Database } from "@sitepulse/db";
import { log } from "./log";

/**
 * Demo data. Sites point at the flaky service and get a backfilled history
 * generated from the same scenarios the service follows live, pushed through
 * the real incident state machine. So the past week, the incidents in it and
 * what visitors watch happen live all come from one set of rules.
 */

const MINUTE = 60_000;
export const DEMO_INTERVAL_SEC = 60;
export const DEMO_TIMEOUT_MS = 5_000;
const INSERT_BATCH = 2_000;

type CheckRow = typeof checks.$inferInsert;

function syntheticCheck(siteId: string, path: string, at: Date): CheckRow {
  const behaviour = demoBehaviour(path, at)!;
  const base = { siteId, checkedAt: at, resolvedIp: "172.30.0.10", redirectCount: 0, dnsMs: 1, connectMs: 0 };
  if (behaviour.kind === "hang") {
    return {
      ...base,
      success: false,
      errorCode: "TTFB_TIMEOUT",
      errorMessage: `Timed out after ${DEMO_TIMEOUT_MS} ms (ttfb)`,
      totalMs: DEMO_TIMEOUT_MS,
    };
  }
  const ttfb = behaviour.delayMs + 1;
  const total = base.dnsMs + base.connectMs + ttfb;
  if (behaviour.kind === "status") {
    return {
      ...base,
      success: false,
      httpStatus: behaviour.status,
      errorCode: behaviour.status >= 500 ? "HTTP_5XX" : "HTTP_4XX",
      errorMessage: `HTTP ${behaviour.status}`,
      ttfbMs: ttfb,
      downloadMs: 0,
      totalMs: total,
    };
  }
  return { ...base, success: true, httpStatus: 200, ttfbMs: ttfb, downloadMs: 0, totalMs: total };
}

/** Writes `days` of one-check-per-minute history for a site, with incidents derived by the real state machine. */
async function backfill(db: Database, siteId: string, path: string, days: number, now: Date) {
  const end = Math.floor(now.getTime() / MINUTE) * MINUTE;
  let health: SiteHealth = INITIAL_HEALTH;
  let batch: CheckRow[] = [];
  let open: { id: string; failed: number } | null = null;
  let last: CheckRow | null = null;

  for (let t = end - days * 24 * 60 * MINUTE; t <= end; t += MINUTE) {
    const row = syntheticCheck(siteId, path, new Date(t));
    batch.push(row);
    last = row;

    const step = transition(
      health,
      { ok: row.success, checkedAt: row.checkedAt, errorCode: (row.errorCode ?? null) as ErrorCode | null },
      { intervalSec: DEMO_INTERVAL_SEC, ...DEFAULT_TRANSITION_CONFIG },
    );
    if (!row.success && health.state === "down" && open) open.failed++;

    for (const event of step.events) {
      if (event.type === "opened") {
        const [created] = await db
          .insert(incidents)
          .values({
            siteId,
            startedAt: event.startedAt,
            causeCode: event.cause,
            lastErrorCode: row.errorCode,
            lastErrorMessage: row.errorMessage,
            failedChecks: step.health.consecutiveFailures,
          })
          .returning({ id: incidents.id });
        open = { id: created!.id, failed: step.health.consecutiveFailures };
        await db.insert(incidentEvents).values({ incidentId: open.id, at: event.startedAt, type: "opened", errorCode: event.cause });
      } else if (event.type === "resolved" && open) {
        await db
          .update(incidents)
          .set({ resolvedAt: event.resolvedAt, failedChecks: open.failed })
          .where(eq(incidents.id, open.id));
        await db.insert(incidentEvents).values({ incidentId: open.id, at: event.resolvedAt, type: "resolved" });
        open = null;
      }
    }
    health = step.health;

    if (batch.length >= INSERT_BATCH) {
      await db.insert(checks).values(batch);
      batch = [];
    }
  }
  if (batch.length) await db.insert(checks).values(batch);

  await db
    .update(sites)
    .set({
      state: health.state,
      consecutiveFailures: health.consecutiveFailures,
      failingSince: health.failingSince,
      lastErrorCode: health.lastErrorCode,
      lastCheckedAt: last?.checkedAt ?? null,
      nextCheckAt: now,
      createdAt: new Date(end - days * 24 * 60 * MINUTE),
      monitoredSince: new Date(end - days * 24 * 60 * MINUTE),
    })
    .where(eq(sites.id, siteId));
}

/**
 * Creates any demo site the owner does not have yet (matched by URL), with
 * backfilled history. Existing sites are left untouched, so it is safe to
 * run on every start.
 */
export async function seedDemoSites(
  db: Database,
  { ownerId, targetUrl, days = 7, now = new Date() }: { ownerId: string; targetUrl: string; days?: number; now?: Date },
): Promise<string[]> {
  const created: string[] = [];
  for (const demo of DEMO_SITES) {
    const url = new URL(demo.path, targetUrl).href;
    const [existing] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.ownerId, ownerId), eq(sites.url, url)));
    if (existing) continue;

    const [site] = await db
      .insert(sites)
      .values({
        ownerId,
        name: demo.name,
        url,
        client: "Demo",
        intervalSec: DEMO_INTERVAL_SEC,
        timeoutMs: DEMO_TIMEOUT_MS,
      })
      .returning({ id: sites.id });
    await backfill(db, site!.id, demo.path, days, now);
    created.push(demo.name);
  }
  return created;
}

/** Public demo bootstrap: the visitor account plus its sites. */
export async function ensureDemo(db: Database, targetUrl: string) {
  await db.insert(user).values(DEMO_USER).onConflictDoNothing();
  const created = await seedDemoSites(db, { ownerId: DEMO_USER.id, targetUrl });
  if (created.length) log("info", "demo sites seeded", { created, targetUrl });
}
