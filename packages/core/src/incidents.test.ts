import { describe, expect, it } from "vitest";
import type { ErrorCode } from "./diagnosis";
import { INITIAL_HEALTH, transition, type SiteHealth, type TransitionConfig } from "./incidents";

const config: TransitionConfig = { intervalSec: 900, recheckSec: 60, failuresToOpen: 2 };
const at = (minute: number) => new Date(Date.UTC(2026, 9, 27, 12, minute));
const ok = (minute: number) => ({ ok: true, checkedAt: at(minute), errorCode: null });
const fail = (minute: number, errorCode: ErrorCode = "HTTP_5XX") => ({ ok: false, checkedAt: at(minute), errorCode });

function run(checks: ReturnType<typeof ok | typeof fail>[], start: SiteHealth = INITIAL_HEALTH) {
  let health = start;
  const events = [];
  for (const check of checks) {
    const t = transition(health, check, config);
    health = t.health;
    events.push(...t.events);
  }
  return { health, events };
}

describe("transition", () => {
  it("goes up on the first success without events", () => {
    const t = transition(INITIAL_HEALTH, ok(0), config);
    expect(t.health.state).toBe("up");
    expect(t.events).toEqual([]);
    expect(t.nextCheckInSec).toBe(900);
  });

  it("treats a single failure as suspect and rechecks fast", () => {
    const t = transition({ ...INITIAL_HEALTH, state: "up" }, fail(0), config);
    expect(t.health.state).toBe("suspect");
    expect(t.events).toEqual([]);
    expect(t.nextCheckInSec).toBe(60);
  });

  it("ignores a blip that recovers on the recheck", () => {
    const { health, events } = run([ok(0), fail(15), ok(16)]);
    expect(health.state).toBe("up");
    expect(events).toEqual([]);
  });

  it("opens one incident on the second failure, backdated to the first", () => {
    const { health, events } = run([ok(0), fail(15), fail(16), fail(17), fail(18)]);
    expect(health.state).toBe("down");
    expect(events).toEqual([{ type: "opened", startedAt: at(15), cause: "HTTP_5XX" }]);
  });

  it("resolves exactly once when the site comes back", () => {
    const { health, events } = run([fail(0), fail(1), fail(2), ok(3), ok(18)]);
    expect(health).toMatchObject({ state: "up", consecutiveFailures: 0, failingSince: null });
    expect(events.filter((e) => e.type === "opened")).toHaveLength(1);
    expect(events.filter((e) => e.type === "resolved")).toEqual([{ type: "resolved", resolvedAt: at(3) }]);
  });

  it("records when an open incident changes cause", () => {
    const { events } = run([fail(0, "TCP_REFUSED"), fail(1, "TCP_REFUSED"), fail(2, "HTTP_5XX"), fail(3, "HTTP_5XX")]);
    expect(events).toEqual([
      { type: "opened", startedAt: at(0), cause: "TCP_REFUSED" },
      { type: "cause_changed", at: at(2), from: "TCP_REFUSED", to: "HTTP_5XX" },
    ]);
  });

  it("never rechecks slower than the configured interval", () => {
    const t = transition(INITIAL_HEALTH, fail(0), { ...config, intervalSec: 30 });
    expect(t.nextCheckInSec).toBe(30);
  });
});
