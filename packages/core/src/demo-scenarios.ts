/**
 * Failure scenarios for the public demo.
 *
 * The built-in "flaky" service answers according to these rules, and the
 * demo's 7-day backfill is generated from the very same rules. History and
 * live data therefore tell one consistent story, driven only by the UTC
 * clock: no state, identical across restarts and replicas.
 */

export type DemoBehaviour =
  | { kind: "ok"; delayMs: number }
  | { kind: "status"; status: number; delayMs: number }
  /** Accept the connection and never answer: the prober reports a TTFB timeout. */
  | { kind: "hang" };

export type DemoSite = {
  path: string;
  name: string;
  /** What this site demonstrates, shown on the demo banner and in docs. */
  story: string;
  scenario: (at: Date, jitter: number) => DemoBehaviour;
};

const around = (base: number, spread: number, jitter: number) => Math.round(base + (jitter - 0.5) * 2 * spread);

export const DEMO_SITES: DemoSite[] = [
  {
    path: "/portfolio",
    name: "Portfolio",
    story: "Always healthy.",
    scenario: (_at, j) => ({ kind: "ok", delayMs: around(55, 12, j) }),
  },
  {
    path: "/shop",
    name: "Sample Shop",
    story: "Backend crashes every 4 hours for 5 minutes: the proxy answers 502.",
    scenario: (at, j) =>
      at.getUTCHours() % 4 === 0 && at.getUTCMinutes() < 5
        ? { kind: "status", status: 502, delayMs: around(25, 8, j) }
        : { kind: "ok", delayMs: around(280, 50, j) },
  },
  {
    path: "/api/health",
    name: "Store API",
    story: "Hangs every 6 hours for 7 minutes: connections open, no response.",
    scenario: (at, j) =>
      at.getUTCHours() % 6 === 1 && at.getUTCMinutes() >= 20 && at.getUTCMinutes() < 27
        ? { kind: "hang" }
        : { kind: "ok", delayMs: around(140, 25, j) },
  },
  {
    path: "/blog",
    name: "Blog",
    story: "Gets 5× slower for one hour every 4 hours, without going down.",
    scenario: (at, j) => ({ kind: "ok", delayMs: around(at.getUTCHours() % 4 === 2 ? 470 : 90, 18, j) }),
  },
];

/** Deterministic 0..1 noise for a path and minute, so replays match. */
export function demoJitter(path: string, at: Date): number {
  let hash = 2166136261;
  const key = `${path}:${Math.floor(at.getTime() / 60_000)}`;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function demoBehaviour(path: string, at: Date): DemoBehaviour | null {
  const site = DEMO_SITES.find((s) => s.path === path);
  return site ? site.scenario(at, demoJitter(path, at)) : null;
}
