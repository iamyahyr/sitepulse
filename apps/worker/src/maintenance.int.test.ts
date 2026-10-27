import {
  alertChannels,
  checkRollupsHourly,
  checks,
  createDb,
  eq,
  notifications,
  siteAlertChannels,
  siteDegradations,
  sites,
  sql,
  user,
  type Database,
} from "@sitepulse/db";
import { migrateDatabase } from "@sitepulse/db/migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateDegradations, pruneOldData, rollupHours } from "./maintenance";

/** See worker.int.test.ts for how to run these locally. */
const url = process.env.TEST_DATABASE_URL;

const OWNER = "test-owner";
const HOUR = 3_600_000;
// A fixed "now" in the middle of an hour keeps hour boundaries predictable.
const NOW = new Date("2026-10-27T12:30:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe.skipIf(!url)("maintenance (Postgres integration)", () => {
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
    await db.insert(user).values({ id: OWNER, name: "Test", email: "owner@sitepulse.test" });
  });

  async function addSite(values: Partial<typeof sites.$inferInsert> = {}) {
    const [site] = await db
      .insert(sites)
      .values({ ownerId: OWNER, name: "Site", url: "https://example.com/", state: "up", intervalSec: 300, ...values })
      .returning();
    return site!;
  }

  const check = (siteId: string, at: Date, totalMs: number, success = true, ttfbMs = totalMs - 20) => ({
    siteId,
    checkedAt: at,
    success,
    httpStatus: success ? 200 : 502,
    errorCode: success ? null : "HTTP_5XX",
    dnsMs: 5,
    connectMs: 5,
    tlsMs: 10,
    ttfbMs,
    downloadMs: 0,
    totalMs,
  });

  describe("rollupHours", () => {
    it("aggregates completed hours only, with latency from successful checks", async () => {
      const site = await addSite();
      await db.insert(checks).values([
        // 10:00-11:00 → three OK (100, 200, 300 ms) and one failure (9000 ms).
        check(site.id, new Date("2026-10-27T10:05:00Z"), 100),
        check(site.id, new Date("2026-10-27T10:20:00Z"), 200),
        check(site.id, new Date("2026-10-27T10:35:00Z"), 300),
        check(site.id, new Date("2026-10-27T10:50:00Z"), 9000, false),
        // 11:00-12:00
        check(site.id, new Date("2026-10-27T11:10:00Z"), 400),
        // Current hour: not complete, must not be rolled up yet.
        check(site.id, new Date("2026-10-27T12:10:00Z"), 500),
      ]);

      await rollupHours(db, NOW);
      const rows = await db.select().from(checkRollupsHourly).orderBy(checkRollupsHourly.hour);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ hour: new Date("2026-10-27T10:00:00Z"), total: 4, ok: 3, p50TotalMs: 200, p50TtfbMs: 180 });
      expect(rows[0]!.p95TotalMs).toBeCloseTo(290, 0);
      expect(rows[1]).toMatchObject({ hour: new Date("2026-10-27T11:00:00Z"), total: 1, ok: 1, p50TotalMs: 400 });
    });

    it("is idempotent and folds in late checks for recent hours", async () => {
      const site = await addSite();
      await db.insert(checks).values(check(site.id, new Date("2026-10-27T11:10:00Z"), 400));
      await rollupHours(db, NOW);
      await rollupHours(db, NOW);
      expect(await db.select().from(checkRollupsHourly)).toHaveLength(1);

      await db.insert(checks).values(check(site.id, new Date("2026-10-27T11:40:00Z"), 600));
      await rollupHours(db, NOW);
      const [row] = await db.select().from(checkRollupsHourly);
      expect(row).toMatchObject({ total: 2, p50TotalMs: 500 });
    });
  });

  describe("pruneOldData", () => {
    it("drops raw checks past retention but keeps their rollups", async () => {
      const site = await addSite();
      await db.insert(checks).values([check(site.id, ago(31 * 24 * HOUR), 100), check(site.id, ago(29 * 24 * HOUR), 100)]);
      await rollupHours(db, NOW);

      const result = await pruneOldData(db, { checkRetentionDays: 30, rollupRetentionDays: 400 }, NOW);
      expect(result).toEqual({ checksDeleted: 1, rollupsDeleted: 0 });
      expect(await db.select().from(checks)).toHaveLength(1);
      expect(await db.select().from(checkRollupsHourly)).toHaveLength(2);

      const later = await pruneOldData(db, { checkRetentionDays: 30, rollupRetentionDays: 30 }, NOW);
      expect(later.rollupsDeleted).toBe(1);
    });
  });

  describe("evaluateDegradations", () => {
    /** Seven days of hourly rollups with a steady TTFB, plus the recent raw checks given. */
    async function siteWithHistory(recentTtfb: number[], recentEndsAt = NOW) {
      const site = await addSite();
      const [channel] = await db
        .insert(alertChannels)
        .values({ ownerId: OWNER, type: "webhook", name: "hook", configEncrypted: "x" })
        .returning();
      await db.insert(siteAlertChannels).values({ siteId: site.id, channelId: channel!.id });
      await db.insert(checkRollupsHourly).values(
        Array.from({ length: 7 * 24 }, (_, i) => ({
          siteId: site.id,
          hour: new Date(Math.floor(NOW.getTime() / HOUR) * HOUR - (i + 2) * HOUR),
          total: 12,
          ok: 12,
          p50TotalMs: 170 + (i % 4),
          p50DnsMs: 5,
          p50ConnectMs: 5,
          p50TlsMs: 10,
          p50TtfbMs: 150 + (i % 4),
          p50DownloadMs: 0,
        })),
      );
      await db.insert(checks).values(
        recentTtfb.map((ttfb, i) => check(site.id, new Date(recentEndsAt.getTime() - i * 5 * 60_000), ttfb + 20, true, ttfb)),
      );
      return site;
    }

    it("opens one degradation for the slowed phase and queues one alert", async () => {
      const site = await siteWithHistory([600, 620, 640, 610, 630]);
      const events = await evaluateDegradations(db, NOW);
      expect(events).toEqual([expect.objectContaining({ type: "opened", siteId: site.id, phase: "ttfb", recentMs: 620 })]);

      const [degradation] = await db.select().from(siteDegradations);
      expect(degradation).toMatchObject({ phase: "ttfb", resolvedAt: null, peakMs: 620 });
      expect(degradation!.baselineMs).toBeGreaterThanOrEqual(150);
      expect(degradation!.baselineMs).toBeLessThanOrEqual(153);

      // Still slow on the next run: no second degradation, no second alert.
      expect(await evaluateDegradations(db, NOW)).toEqual([]);
      const queued = await db.select().from(notifications);
      expect(queued).toEqual([expect.objectContaining({ kind: "degraded", degradationId: degradation!.id, incidentId: null })]);
    });

    it("stays quiet for normal noise and for sites without enough history", async () => {
      await siteWithHistory([155, 160, 150, 158, 162]);
      const fresh = await addSite({ name: "new" });
      await db.insert(checks).values([1, 2, 3, 4, 5].map((i) => check(fresh.id, ago(i * 5 * 60_000), 900, true, 880)));
      expect(await evaluateDegradations(db, NOW)).toEqual([]);
    });

    it("resolves once the phase is back near its baseline", async () => {
      const site = await siteWithHistory([600, 620, 640, 610, 630], ago(2 * HOUR));
      await db.insert(checks).values([1, 2, 3, 4].map((i) => check(site.id, ago(i * 10 * 60_000), 600, true, 580)));
      await evaluateDegradations(db, NOW);

      // An hour later only fast checks remain in the window.
      const later = new Date(NOW.getTime() + HOUR);
      await db.insert(checks).values([1, 2, 3, 4].map((i) => check(site.id, new Date(later.getTime() - i * 10 * 60_000), 175, true, 155)));
      const events = await evaluateDegradations(db, later);
      expect(events).toEqual([{ type: "resolved", siteId: site.id, phase: "ttfb" }]);
      const [degradation] = await db.select().from(siteDegradations);
      expect(degradation!.resolvedAt).toEqual(later);
    });

    it("closes degradations of sites that went down or were paused", async () => {
      const site = await siteWithHistory([600, 620, 640, 610, 630]);
      await evaluateDegradations(db, NOW);
      await db.update(sites).set({ state: "down" }).where(eq(sites.id, site.id));
      expect(await evaluateDegradations(db, NOW)).toEqual([{ type: "resolved", siteId: site.id, phase: "ttfb" }]);
    });
  });
});
