import { DEMO_USER, checks, createDb, eq, incidents, sites, sql, user, type Database } from "@sitepulse/db";
import { migrateDatabase } from "@sitepulse/db/migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDemo, seedDemoSites } from "./demo";

/** See worker.int.test.ts for how to run these locally. */
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-10-27T12:30:00Z");
const TARGET = "http://flaky:8080";

describe.skipIf(!url)("demo seeding (Postgres integration)", () => {
  let db: Database;

  beforeAll(async () => {
    await migrateDatabase(url!);
    db = createDb(url!, { max: 5 });
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate "user", worker_heartbeats restart identity cascade`);
  });

  async function incidentsOf(name: string) {
    const [site] = await db.select().from(sites).where(eq(sites.name, name));
    return db.select().from(incidents).where(eq(incidents.siteId, site!.id)).orderBy(incidents.startedAt);
  }

  it("backfills one check per minute and derives incidents from the scenarios", async () => {
    await db.insert(user).values({ id: "owner", name: "Owner", email: "owner@sitepulse.test" });
    const created = await seedDemoSites(db, { ownerId: "owner", targetUrl: TARGET, days: 1, now: NOW });
    expect(created).toEqual(["Portfolio", "Sample Shop", "Store API", "Blog"]);

    const all = await db.select().from(sites).orderBy(sites.name);
    expect(all.map((s) => s.url).sort()).toEqual(
      ["/api/health", "/blog", "/portfolio", "/shop"].map((p) => `${TARGET}${p}`).sort(),
    );
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from ${checks}`)) as unknown as [{ n: number }];
    expect(n).toBe(4 * (24 * 60 + 1));

    // 502 at the top of every 4th hour: 16:00, 20:00, 00:00, 04:00, 08:00, 12:00 → 5 minutes each.
    const shop = await incidentsOf("Sample Shop");
    expect(shop).toHaveLength(6);
    for (const incident of shop) {
      expect(incident.causeCode).toBe("HTTP_5XX");
      expect(incident.startedAt.getUTCMinutes()).toBe(0);
      expect(incident.resolvedAt!.getTime() - incident.startedAt.getTime()).toBe(5 * 60_000);
    }

    // Hangs at :20-:27 every 6th hour from 01:00: 13:20, 19:20, 01:20, 07:20.
    const api = await incidentsOf("Store API");
    expect(api.map((i) => i.startedAt.toISOString().slice(11, 16))).toEqual(["13:20", "19:20", "01:20", "07:20"]);
    expect(api.every((i) => i.causeCode === "TTFB_TIMEOUT")).toBe(true);

    // Slowdowns are not outages.
    expect(await incidentsOf("Blog")).toHaveLength(0);
    expect(await incidentsOf("Portfolio")).toHaveLength(0);

    const [portfolio] = await db.select().from(sites).where(eq(sites.name, "Portfolio"));
    expect(portfolio).toMatchObject({ state: "up", intervalSec: 60, nextCheckAt: NOW });
  });

  it("is idempotent and creates the demo visitor", async () => {
    await ensureDemo(db, TARGET);
    const count = async () => (await db.select().from(sites)).length;
    expect(await count()).toBe(4);
    await ensureDemo(db, TARGET);
    expect(await count()).toBe(4);
    const [visitor] = await db.select().from(user).where(eq(user.id, DEMO_USER.id));
    expect(visitor).toMatchObject({ email: DEMO_USER.email });
  });
});
