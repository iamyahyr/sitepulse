import { decryptJson, sendAlert, type AlertEvent, type ChannelConfig, type ErrorCode, type PostOptions } from "@sitepulse/core";
import {
  alertChannels,
  and,
  asc,
  checks,
  desc,
  eq,
  gte,
  incidents,
  inArray,
  lte,
  notifications,
  siteDegradations,
  sites,
  sql,
  type Database,
} from "@sitepulse/db";
import { log } from "./log";

/**
 * Delivers the alert outbox.
 *
 * Rows are written by recordResult() in the same transaction that opens or
 * resolves an incident; the unique (incident, channel, kind) key means each
 * alert exists exactly once. Here they are claimed with SKIP LOCKED (so
 * several workers can dispatch side by side), sent outside any transaction,
 * and marked sent, rescheduled with exponential backoff, or failed.
 *
 * Delivery is at-least-once: a crash between sending and marking can resend,
 * which is why every payload carries a stable delivery id.
 */

export type DispatcherOptions = {
  secretKey: string;
  /** Public URL of the web app, for links in alerts. */
  appUrl: string | null;
  postOptions?: PostOptions;
  batchSize?: number;
  maxAttempts?: number;
};

/** A claimed row stays invisible to other dispatchers for this long. */
const CLAIM_LEASE_MS = 2 * 60_000;
export const MAX_ATTEMPTS = 8;

export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** (attempt - 1), 60 * 60_000);
}

async function claim(db: Database, limit: number, now: Date) {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.status, "pending"), lte(notifications.nextAttemptAt, now)))
      .orderBy(asc(notifications.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];

    return tx
      .update(notifications)
      .set({
        attempts: sql`${notifications.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
      })
      .where(inArray(notifications.id, due.map((n) => n.id)))
      .returning({ id: notifications.id, attempts: notifications.attempts });
  });
}

/** Builds the alert from whichever subject the outbox row points at: an incident or a degradation. */
async function buildEvent(
  db: Database,
  notification: typeof notifications.$inferSelect,
  appUrl: string | null,
): Promise<AlertEvent | null> {
  const dashboardUrl = (siteId: string) => (appUrl ? new URL(`/sites/${siteId}`, appUrl).href : null);

  if (notification.degradationId) {
    const [row] = await db
      .select({ degradation: siteDegradations, site: sites })
      .from(siteDegradations)
      .innerJoin(sites, eq(sites.id, siteDegradations.siteId))
      .where(eq(siteDegradations.id, notification.degradationId));
    if (!row) return null;
    return {
      kind: "degraded",
      deliveryId: notification.id,
      site: { id: row.site.id, name: row.site.name, url: row.site.url },
      incident: null,
      degradation: {
        id: row.degradation.id,
        phase: row.degradation.phase,
        startedAt: row.degradation.startedAt,
        baselineMs: row.degradation.baselineMs,
        recentMs: row.degradation.peakMs,
      },
      dashboardUrl: dashboardUrl(row.site.id),
    };
  }

  const [row] = await db
    .select({ incident: incidents, site: sites })
    .from(incidents)
    .innerJoin(sites, eq(sites.id, incidents.siteId))
    .where(eq(incidents.id, notification.incidentId!));
  if (!row) return null;
  const [lastFailed] = await db
    .select({ httpStatus: checks.httpStatus })
    .from(checks)
    .where(and(eq(checks.siteId, row.site.id), eq(checks.success, false), gte(checks.checkedAt, row.incident.startedAt)))
    .orderBy(desc(checks.checkedAt))
    .limit(1);
  return {
    kind: notification.kind === "up" ? "up" : "down",
    deliveryId: notification.id,
    site: { id: row.site.id, name: row.site.name, url: row.site.url },
    incident: {
      id: row.incident.id,
      startedAt: row.incident.startedAt,
      resolvedAt: row.incident.resolvedAt,
      cause: row.incident.causeCode as ErrorCode,
      lastErrorMessage: row.incident.lastErrorMessage,
      httpStatus: lastFailed?.httpStatus ?? null,
    },
    dashboardUrl: dashboardUrl(row.site.id),
  };
}

async function deliver(db: Database, id: string, attempt: number, options: DispatcherOptions) {
  const [row] = await db
    .select({ notification: notifications, channel: alertChannels })
    .from(notifications)
    .innerJoin(alertChannels, eq(alertChannels.id, notifications.channelId))
    .where(eq(notifications.id, id));
  if (!row) return; // Cascaded away (site or channel deleted) meanwhile.

  const finish = (values: Partial<typeof notifications.$inferInsert>) =>
    db.update(notifications).set(values).where(eq(notifications.id, id));

  let config: ChannelConfig;
  try {
    config = decryptJson<ChannelConfig>(options.secretKey, row.channel.configEncrypted);
  } catch {
    await finish({ status: "failed", lastError: "Cannot decrypt channel config. Was SITEPULSE_SECRET_KEY changed?" });
    log("error", "alert failed: undecryptable channel", { notificationId: id, channelId: row.channel.id });
    return;
  }

  const event = await buildEvent(db, row.notification, options.appUrl);
  if (!event) return;
  const result = await sendAlert(config, event, options.postOptions);

  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  if (result.ok) {
    await finish({ status: "sent", sentAt: new Date(), lastError: null });
    log("info", "alert sent", { notificationId: id, kind: row.notification.kind, channel: row.channel.type, siteId: event.site.id });
  } else if (!result.retryable || attempt >= maxAttempts) {
    await finish({ status: "failed", lastError: result.error });
    log("error", "alert failed", { notificationId: id, attempt, error: result.error });
  } else {
    const delay = Math.max(backoffMs(attempt), (result.retryAfterSec ?? 0) * 1000);
    await finish({ nextAttemptAt: new Date(Date.now() + delay), lastError: result.error });
    log("warn", "alert retry scheduled", { notificationId: id, attempt, inSec: Math.round(delay / 1000), error: result.error });
  }
}

/** One round: claim a batch of due alerts and deliver them concurrently. Returns how many were claimed. */
export async function dispatchOnce(db: Database, options: DispatcherOptions, now = new Date()): Promise<number> {
  const claimed = await claim(db, options.batchSize ?? 10, now);
  await Promise.all(
    claimed.map((n) =>
      deliver(db, n.id, n.attempts, options).catch((err) =>
        // The claim lease expires and the alert is retried.
        log("error", "alert delivery crashed", { notificationId: n.id, error: String(err) }),
      ),
    ),
  );
  return claimed.length;
}
