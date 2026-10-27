import type { ErrorCode } from "./diagnosis";

/**
 * Site health state machine.
 *
 *   unknown/up ──fail──▶ suspect ──fail──▶ down (incident opened, alert)
 *        ▲                  │                 │
 *        └──────ok──────────┴───────ok────────┘ (incident resolved, alert)
 *
 * A single failure only makes a site "suspect" and pulls the next check
 * forward; the second consecutive failure confirms the outage. The incident's
 * start is backdated to the first failed check, so downtime is not
 * under-reported by one interval.
 */

export type SiteState = "unknown" | "up" | "suspect" | "down";

export type SiteHealth = {
  state: SiteState;
  consecutiveFailures: number;
  /** When the current failure streak began; null while healthy. */
  failingSince: Date | null;
  /** Cause of the last failure, to spot when an open incident changes cause. */
  lastErrorCode: ErrorCode | null;
};

export type CheckOutcome = {
  ok: boolean;
  checkedAt: Date;
  errorCode: ErrorCode | null;
};

export type IncidentEvent =
  | { type: "opened"; startedAt: Date; cause: ErrorCode }
  | { type: "cause_changed"; at: Date; from: ErrorCode; to: ErrorCode }
  | { type: "resolved"; resolvedAt: Date };

export type Transition = {
  health: SiteHealth;
  events: IncidentEvent[];
  /** Seconds until the next check: the normal interval, or the fast recheck while in doubt. */
  nextCheckInSec: number;
};

export type TransitionConfig = {
  intervalSec: number;
  recheckSec: number;
  failuresToOpen: number;
};

export const DEFAULT_TRANSITION_CONFIG = { recheckSec: 60, failuresToOpen: 2 } as const;

export const INITIAL_HEALTH: SiteHealth = {
  state: "unknown",
  consecutiveFailures: 0,
  failingSince: null,
  lastErrorCode: null,
};

const HEALTHY: SiteHealth = { ...INITIAL_HEALTH, state: "up" };

export function transition(health: SiteHealth, check: CheckOutcome, config: TransitionConfig): Transition {
  const fastRecheck = Math.min(config.recheckSec, config.intervalSec);

  if (check.ok) {
    return {
      health: HEALTHY,
      events: health.state === "down" ? [{ type: "resolved", resolvedAt: check.checkedAt }] : [],
      nextCheckInSec: config.intervalSec,
    };
  }

  const cause = check.errorCode ?? "UNKNOWN";
  const failures = health.consecutiveFailures + 1;
  const failingSince = health.failingSince ?? check.checkedAt;
  const next: SiteHealth = { state: health.state, consecutiveFailures: failures, failingSince, lastErrorCode: cause };

  if (health.state === "down") {
    const events: IncidentEvent[] =
      health.lastErrorCode && health.lastErrorCode !== cause
        ? [{ type: "cause_changed", at: check.checkedAt, from: health.lastErrorCode, to: cause }]
        : [];
    return { health: next, events, nextCheckInSec: fastRecheck };
  }

  if (failures >= config.failuresToOpen) {
    return {
      health: { ...next, state: "down" },
      events: [{ type: "opened", startedAt: failingSince, cause }],
      nextCheckInSec: fastRecheck,
    };
  }

  return { health: { ...next, state: "suspect" }, events: [], nextCheckInSec: fastRecheck };
}
