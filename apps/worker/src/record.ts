import {
  DEFAULT_TRANSITION_CONFIG,
  transition,
  type ErrorCode,
  type IncidentEvent,
  type ProbeResult,
} from "@sitepulse/core";
import {
  and,
  checks,
  eq,
  incidentEvents,
  incidents,
  isNull,
  notifications,
  siteAlertChannels,
  sites,
  sql,
  type Database,
} from "@sitepulse/db";
import type { ClaimedSite } from "./scheduler";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type RecordOutcome =
  | { recorded: false; reason: "site_gone" | "site_changed" }
  | { recorded: true; events: IncidentEvent[]; nextCheckAt: Date };

const clip = (text: string | null, max = 500) => (text && text.length > max ? `${text.slice(0, max)}…` : text);

/** Queues one alert per linked channel. The unique key makes a retry a no-op. */
async function enqueueAlerts(tx: Tx, siteId: string, incidentId: string, kind: "down" | "up") {
  const channels = await tx
    .select({ channelId: siteAlertChannels.channelId })
    .from(siteAlertChannels)
    .where(eq(siteAlertChannels.siteId, siteId));
  if (channels.length === 0) return;
  await tx
    .insert(notifications)
    .values(channels.map(({ channelId }) => ({ incidentId, channelId, kind })))
    .onConflictDoNothing();
}

/**
 * Persists one probe result and advances the site's state machine, all in a
 * single transaction: the check row, the site's health, the incident and its
 * timeline, and the outbox rows for alerts either all commit or none do.
 */
export async function recordResult(
  db: Database,
  claimed: ClaimedSite,
  result: ProbeResult,
  checkedAt: Date,
): Promise<RecordOutcome> {
  return db.transaction(async (tx) => {
    const [site] = await tx.select().from(sites).where(eq(sites.id, claimed.id)).for("update");
    if (!site) return { recorded: false, reason: "site_gone" };
    // Edited or paused while the probe was in flight: this result describes a
    // configuration that no longer exists, so it must not move the state machine.
    if (!site.enabled || site.url !== claimed.url) return { recorded: false, reason: "site_changed" };

    await tx.insert(checks).values({
      siteId: site.id,
      checkedAt,
      success: result.ok,
      httpStatus: result.status,
      errorCode: result.errorCode,
      errorMessage: clip(result.errorMessage),
      dnsMs: result.timings.dns,
      connectMs: result.timings.connect,
      tlsMs: result.timings.tls,
      ttfbMs: result.timings.ttfb,
      downloadMs: result.timings.download,
      totalMs: result.timings.total,
      resolvedIp: result.resolvedIp,
      redirectCount: result.redirects,
    });

    const step = transition(
      {
        state: site.state,
        consecutiveFailures: site.consecutiveFailures,
        failingSince: site.failingSince,
        lastErrorCode: site.lastErrorCode as ErrorCode | null,
      },
      { ok: result.ok, checkedAt, errorCode: result.errorCode },
      { intervalSec: site.intervalSec, ...DEFAULT_TRANSITION_CONFIG },
    );

    const openIncident = async () =>
      (
        await tx
          .select({ id: incidents.id })
          .from(incidents)
          .where(and(eq(incidents.siteId, site.id), isNull(incidents.resolvedAt)))
      )[0];

    for (const event of step.events) {
      if (event.type === "opened") {
        const [created] = await tx
          .insert(incidents)
          .values({
            siteId: site.id,
            startedAt: event.startedAt,
            causeCode: event.cause,
            lastErrorCode: result.errorCode,
            lastErrorMessage: clip(result.errorMessage),
            failedChecks: step.health.consecutiveFailures,
          })
          // The partial unique index allows one open incident per site.
          .onConflictDoNothing()
          .returning({ id: incidents.id });
        if (!created) continue;
        await tx.insert(incidentEvents).values({ incidentId: created.id, at: event.startedAt, type: "opened", errorCode: event.cause });
        await enqueueAlerts(tx, site.id, created.id, "down");
      } else if (event.type === "cause_changed") {
        const open = await openIncident();
        if (open) await tx.insert(incidentEvents).values({ incidentId: open.id, at: event.at, type: "cause_changed", errorCode: event.to });
      } else {
        const open = await openIncident();
        if (!open) continue;
        await tx.update(incidents).set({ resolvedAt: event.resolvedAt }).where(eq(incidents.id, open.id));
        await tx.insert(incidentEvents).values({ incidentId: open.id, at: event.resolvedAt, type: "resolved" });
        await enqueueAlerts(tx, site.id, open.id, "up");
      }
    }

    // A failure while already down extends the open incident.
    if (!result.ok && site.state === "down") {
      await tx
        .update(incidents)
        .set({
          failedChecks: sql`${incidents.failedChecks} + 1`,
          lastErrorCode: result.errorCode,
          lastErrorMessage: clip(result.errorMessage),
        })
        .where(and(eq(incidents.siteId, site.id), isNull(incidents.resolvedAt)));
    }

    const nextCheckAt = new Date(checkedAt.getTime() + step.nextCheckInSec * 1000);
    await tx
      .update(sites)
      .set({
        state: step.health.state,
        consecutiveFailures: step.health.consecutiveFailures,
        failingSince: step.health.failingSince,
        lastErrorCode: step.health.lastErrorCode,
        lastCheckedAt: checkedAt,
        nextCheckAt,
        ...(result.tlsValidTo && { tlsExpiresAt: result.tlsValidTo }),
      })
      .where(eq(sites.id, site.id));

    return { recorded: true, events: step.events, nextCheckAt };
  });
}
