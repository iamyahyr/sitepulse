import {
  computeUptime,
  median,
  type ErrorCode,
  type Interval,
  type SiteState,
} from "@sitepulse/core";

/**
 * Deterministic demo data for the dashboard until the database is wired in
 * (SP-02). Generated from a seeded PRNG against a fixed clock so the page is
 * fully static and identical on every render.
 */

export const NOW = new Date("2026-10-27T12:00:00Z");
const HOUR = 3_600_000;

export type Phases = { dns: number; connect: number; tls: number; ttfb: number; download: number };

export type MockCheck = {
  at: Date;
  ok: boolean;
  status: number | null;
  errorCode: ErrorCode | null;
  phases: Phases;
};

export type MockIncident = Interval & { cause: ErrorCode; timeline: { at: Date; label: string }[] };

export type MockSite = {
  id: string;
  name: string;
  url: string;
  client: string;
  state: SiteState;
  lastCheckedAt: Date;
  tlsExpiresAt: Date;
  checks: MockCheck[];
  incidents: MockIncident[];
  uptime7d: number | null;
  p50Ms: number | null;
};

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const total = (p: Phases) => p.dns + p.connect + p.tls + p.ttfb + p.download;

type Profile = {
  id: string;
  name: string;
  url: string;
  client: string;
  seed: number;
  base: Phases;
  jitter: number;
  /** Hours ago: [start, end|null] of synthetic outages. */
  outages: { from: number; to: number | null; cause: ErrorCode; status: number | null }[];
  tlsDays: number;
};

const PROFILES: Profile[] = [
  {
    id: "portfolio",
    name: "Portfolio",
    url: "https://portfolio.example.com",
    client: "Personal",
    seed: 7,
    base: { dns: 8, connect: 22, tls: 31, ttfb: 64, download: 12 },
    jitter: 0.25,
    outages: [],
    tlsDays: 61,
  },
  {
    id: "api",
    name: "Test API",
    url: "https://api.example.dev/health",
    client: "Acme Studio",
    seed: 21,
    base: { dns: 11, connect: 38, tls: 44, ttfb: 140, download: 6 },
    jitter: 0.35,
    outages: [{ from: 52, to: 51.25, cause: "TCP_REFUSED", status: null }],
    tlsDays: 9,
  },
  {
    id: "shop",
    name: "Sample Shop",
    url: "https://shop.example.org",
    client: "Acme Studio",
    seed: 42,
    base: { dns: 9, connect: 41, tls: 52, ttfb: 310, download: 48 },
    jitter: 0.3,
    outages: [
      { from: 120, to: 119.5, cause: "TLS_CERT_EXPIRED", status: null },
      { from: 0.6, to: null, cause: "HTTP_5XX", status: 502 },
    ],
    tlsDays: 44,
  },
];

function buildChecks(profile: Profile): MockCheck[] {
  const rand = prng(profile.seed);
  const checks: MockCheck[] = [];
  // 7 days at 15-minute resolution.
  for (let i = 7 * 24 * 4; i >= 0; i--) {
    const hoursAgo = i / 4;
    const at = new Date(NOW.getTime() - hoursAgo * HOUR);
    const outage = profile.outages.find((o) => hoursAgo <= o.from && (o.to === null || hoursAgo >= o.to));
    const wobble = (v: number) => Math.max(1, Math.round(v * (1 + (rand() - 0.5) * 2 * profile.jitter)));
    // Afternoon traffic makes the backend a little slower.
    const load = 1 + 0.35 * Math.max(0, Math.sin(((at.getUTCHours() - 8) / 24) * Math.PI * 2));
    const phases: Phases = {
      dns: wobble(profile.base.dns),
      connect: wobble(profile.base.connect),
      tls: wobble(profile.base.tls),
      ttfb: wobble(profile.base.ttfb * load),
      download: wobble(profile.base.download),
    };

    if (outage) {
      const failed: Phases =
        outage.cause === "TCP_REFUSED"
          ? { ...phases, connect: 0, tls: 0, ttfb: 0, download: 0 }
          : outage.cause === "TLS_CERT_EXPIRED"
            ? { ...phases, tls: wobble(40), ttfb: 0, download: 0 }
            : { ...phases, ttfb: wobble(30), download: 2 };
      checks.push({ at, ok: false, status: outage.status, errorCode: outage.cause, phases: failed });
    } else {
      checks.push({ at, ok: true, status: 200, errorCode: null, phases });
    }
  }
  return checks;
}

function buildIncidents(profile: Profile): MockIncident[] {
  return profile.outages.map((o) => {
    const start = new Date(NOW.getTime() - o.from * HOUR);
    const end = o.to === null ? null : new Date(NOW.getTime() - o.to * HOUR);
    const timeline = [
      { at: start, label: "First failed check" },
      { at: new Date(start.getTime() + 60_000), label: "Confirmed on recheck · incident opened · alert sent" },
    ];
    if (end) timeline.push({ at: end, label: "Recovered · recovery alert sent" });
    return { start, end, cause: o.cause, timeline };
  });
}

function buildSite(profile: Profile): MockSite {
  const checks = buildChecks(profile);
  const incidents = buildIncidents(profile);
  const last = checks.at(-1)!;
  const open = incidents.some((i) => i.end === null);
  const uptime = computeUptime(incidents, { from: new Date(NOW.getTime() - 7 * 24 * HOUR), to: NOW }, new Date(0));
  const day = checks.filter((c) => c.ok && c.at.getTime() > NOW.getTime() - 24 * HOUR);

  return {
    id: profile.id,
    name: profile.name,
    url: profile.url,
    client: profile.client,
    state: open ? "down" : last.ok ? "up" : "suspect",
    lastCheckedAt: new Date(NOW.getTime() - 42_000),
    tlsExpiresAt: new Date(NOW.getTime() + profile.tlsDays * 24 * HOUR),
    checks,
    incidents,
    uptime7d: uptime.ratio,
    p50Ms: median(day.map((c) => total(c.phases))),
  };
}

export const sites: MockSite[] = PROFILES.map(buildSite);

export const workerLastSeen = new Date(NOW.getTime() - 12_000);

export function checkTotal(check: MockCheck) {
  return total(check.phases);
}
