/**
 * Seeds three demo sites with 7 days of synthetic checks and incidents for an
 * existing user, so the dashboard can be developed and screenshotted before
 * the worker has produced real history.
 *
 *   pnpm db:seed you@example.com
 *
 * Deterministic (seeded PRNG) relative to the current time. Re-running it
 * replaces the demo sites of that user.
 */
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "./index";
import { checks, incidentEvents, incidents, sites, user } from "./schema";

const HOUR = 3_600_000;
const STEP_MIN = 15;

type Phases = { dns: number; connect: number; tls: number; ttfb: number; download: number };

type Outage = { fromHoursAgo: number; toHoursAgo: number | null; cause: string; status: number | null };

type Profile = {
  name: string;
  url: string;
  client: string;
  seed: number;
  base: Phases;
  jitter: number;
  outages: Outage[];
  tlsDays: number;
};

const PROFILES: Profile[] = [
  {
    name: "Portfolio (demo)",
    url: "https://portfolio.example.com/",
    client: "Personal",
    seed: 7,
    base: { dns: 8, connect: 22, tls: 31, ttfb: 64, download: 12 },
    jitter: 0.25,
    outages: [],
    tlsDays: 61,
  },
  {
    name: "Test API (demo)",
    url: "https://api.example.com/health",
    client: "Acme Studio",
    seed: 21,
    base: { dns: 11, connect: 38, tls: 44, ttfb: 140, download: 6 },
    jitter: 0.35,
    outages: [{ fromHoursAgo: 30, toHoursAgo: 29.25, cause: "TCP_REFUSED", status: null }],
    tlsDays: 9,
  },
  {
    name: "Sample Shop (demo)",
    url: "https://shop.example.com/",
    client: "Acme Studio",
    seed: 42,
    base: { dns: 9, connect: 41, tls: 52, ttfb: 310, download: 48 },
    jitter: 0.3,
    outages: [
      { fromHoursAgo: 120, toHoursAgo: 119.5, cause: "TLS_CERT_EXPIRED", status: null },
      { fromHoursAgo: 0.6, toHoursAgo: null, cause: "HTTP_5XX", status: 502 },
    ],
    tlsDays: 44,
  },
];

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function synthesize(profile: Profile, siteId: string, now: number) {
  const rand = prng(profile.seed);
  const rows: (typeof checks.$inferInsert)[] = [];
  const steps = (7 * 24 * 60) / STEP_MIN;

  for (let i = steps; i >= 0; i--) {
    const hoursAgo = (i * STEP_MIN) / 60;
    const at = new Date(now - hoursAgo * HOUR);
    const wobble = (v: number) => Math.max(1, Math.round(v * (1 + (rand() - 0.5) * 2 * profile.jitter)));
    const load = 1 + 0.35 * Math.max(0, Math.sin(((at.getUTCHours() - 8) / 24) * Math.PI * 2));
    const p: Phases = {
      dns: wobble(profile.base.dns),
      connect: wobble(profile.base.connect),
      tls: wobble(profile.base.tls),
      ttfb: wobble(profile.base.ttfb * load),
      download: wobble(profile.base.download),
    };
    const outage = profile.outages.find(
      (o) => hoursAgo <= o.fromHoursAgo && (o.toHoursAgo === null || hoursAgo >= o.toHoursAgo),
    );

    const base = { siteId, checkedAt: at, resolvedIp: "93.184.215.14", redirectCount: 0 };
    if (!outage) {
      rows.push({
        ...base,
        success: true,
        httpStatus: 200,
        dnsMs: p.dns,
        connectMs: p.connect,
        tlsMs: p.tls,
        ttfbMs: p.ttfb,
        downloadMs: p.download,
        totalMs: p.dns + p.connect + p.tls + p.ttfb + p.download,
      });
    } else if (outage.cause === "TCP_REFUSED") {
      rows.push({ ...base, success: false, errorCode: outage.cause, errorMessage: "connect ECONNREFUSED", dnsMs: p.dns, totalMs: p.dns + 2 });
    } else if (outage.cause === "TLS_CERT_EXPIRED") {
      rows.push({
        ...base,
        success: false,
        errorCode: outage.cause,
        errorMessage: "certificate has expired",
        dnsMs: p.dns,
        connectMs: p.connect,
        totalMs: p.dns + p.connect + 40,
      });
    } else {
      const ttfb = wobble(30);
      rows.push({
        ...base,
        success: false,
        httpStatus: outage.status,
        errorCode: outage.cause,
        errorMessage: `HTTP ${outage.status}`,
        dnsMs: p.dns,
        connectMs: p.connect,
        tlsMs: p.tls,
        ttfbMs: ttfb,
        downloadMs: 2,
        totalMs: p.dns + p.connect + p.tls + ttfb + 2,
      });
    }
  }
  return rows;
}

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: pnpm db:seed <email of an existing user>");

  const db = createDb(process.env.DATABASE_URL ?? "postgres://sitepulse:sitepulse@localhost:5442/sitepulse", { max: 1 });
  const [owner] = await db.select().from(user).where(eq(user.email, email));
  if (!owner) throw new Error(`No user with email ${email}. Create it on /setup first.`);

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.delete(sites).where(and(eq(sites.ownerId, owner.id), inArray(sites.name, PROFILES.map((p) => p.name))));

    for (const profile of PROFILES) {
      const open = profile.outages.find((o) => o.toHoursAgo === null);
      const [site] = await tx
        .insert(sites)
        .values({
          ownerId: owner.id,
          name: profile.name,
          url: profile.url,
          client: profile.client,
          intervalSec: STEP_MIN * 60,
          state: open ? "down" : "up",
          consecutiveFailures: open ? Math.ceil((open.fromHoursAgo * 60) / STEP_MIN) : 0,
          failingSince: open ? new Date(now - open.fromHoursAgo * HOUR) : null,
          lastErrorCode: open?.cause ?? null,
          lastCheckedAt: new Date(now),
          nextCheckAt: new Date(now + STEP_MIN * 60_000),
          tlsExpiresAt: new Date(now + profile.tlsDays * 24 * HOUR),
          createdAt: new Date(now - 7 * 24 * HOUR),
        })
        .returning();

      await tx.insert(checks).values(synthesize(profile, site!.id, now));

      for (const outage of profile.outages) {
        const startedAt = new Date(now - outage.fromHoursAgo * HOUR);
        const resolvedAt = outage.toHoursAgo === null ? null : new Date(now - outage.toHoursAgo * HOUR);
        const [incident] = await tx
          .insert(incidents)
          .values({
            siteId: site!.id,
            startedAt,
            resolvedAt,
            causeCode: outage.cause,
            lastErrorCode: outage.cause,
            failedChecks: Math.ceil((((outage.toHoursAgo ?? 0) - outage.fromHoursAgo) * -60) / STEP_MIN),
          })
          .returning();
        await tx.insert(incidentEvents).values([
          { incidentId: incident!.id, at: startedAt, type: "opened", errorCode: outage.cause },
          ...(resolvedAt ? [{ incidentId: incident!.id, at: resolvedAt, type: "resolved" as const }] : []),
        ]);
      }
    }
  });

  console.log(`Seeded ${PROFILES.length} demo sites for ${email}.`);
  await db.$client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
