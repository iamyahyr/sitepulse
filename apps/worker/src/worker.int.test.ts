import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ErrorCode, ProbeResult } from "@sitepulse/core";
import {
  alertChannels,
  createDb,
  eq,
  incidentEvents,
  incidents,
  notifications,
  siteAlertChannels,
  sites,
  sql,
  user,
  workerHeartbeats,
  checks,
  type Database,
} from "@sitepulse/db";
import { migrateDatabase } from "@sitepulse/db/migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordResult } from "./record";
import { claimDueSites } from "./scheduler";
import { Worker } from "./worker";

/**
 * Runs against a real Postgres. Locally:
 *   docker compose -f docker-compose.dev.yml up -d
 *   TEST_DATABASE_URL=postgres://sitepulse:sitepulse@localhost:5442/sitepulse_test pnpm --filter @sitepulse/worker test
 * The database is wiped between tests, so never point this at real data.
 */
const url = process.env.TEST_DATABASE_URL;

const OWNER = "test-owner";
const minutes = (n: number) => new Date(Date.UTC(2026, 9, 27, 12, n));

function fakeResult(ok: boolean, errorCode: ErrorCode | null = ok ? null : "HTTP_5XX"): ProbeResult {
  return {
    ok,
    status: ok ? 200 : errorCode === "HTTP_5XX" ? 502 : null,
    errorCode,
    errorMessage: ok ? null : `simulated ${errorCode}`,
    timings: { dns: 5, connect: 10, tls: 20, ttfb: 30, download: 2, total: 67 },
    resolvedIp: "93.184.215.14",
    redirects: 0,
    finalUrl: "https://example.com/",
    bodyBytes: 10,
    tlsValidTo: null,
  };
}

describe.skipIf(!url)("worker (Postgres integration)", () => {
  let db: Database;

  beforeAll(async () => {
    await migrateDatabase(url!);
    db = createDb(url!, { max: 10 });
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
      .values({ ownerId: OWNER, name: "Site", url: "https://example.com/", nextCheckAt: new Date(0), ...values })
      .returning();
    return site!;
  }

  describe("claimDueSites", () => {
    it("never hands the same site to two concurrent workers", async () => {
      for (let i = 0; i < 6; i++) await addSite({ name: `due ${i}` });
      await addSite({ name: "future", nextCheckAt: new Date(Date.now() + 3_600_000) });
      await addSite({ name: "paused", enabled: false });

      const batches = await Promise.all([claimDueSites(db, 4), claimDueSites(db, 4), claimDueSites(db, 4)]);
      const ids = batches.flat().map((s) => s.id);

      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
      expect(await claimDueSites(db, 10)).toEqual([]);
    });

    it("leases claimed sites past the probe timeout", async () => {
      const site = await addSite({ timeoutMs: 10_000 });
      const now = new Date();
      await claimDueSites(db, 1, now);
      const [row] = await db.select().from(sites).where(eq(sites.id, site.id));
      expect(row!.nextCheckAt.getTime() - now.getTime()).toBe(40_000);
    });
  });

  describe("recordResult", () => {
    it("runs the full incident lifecycle with exactly one alert each way", async () => {
      const site = await addSite({ intervalSec: 900 });
      const [channel] = await db
        .insert(alertChannels)
        .values({ ownerId: OWNER, type: "discord", name: "ops", configEncrypted: "x" })
        .returning();
      await db.insert(siteAlertChannels).values({ siteId: site.id, channelId: channel!.id });

      const first = await recordResult(db, site, fakeResult(false), minutes(0));
      expect(first).toMatchObject({ recorded: true, events: [], nextCheckAt: minutes(1) });
      expect((await db.select().from(sites).where(eq(sites.id, site.id)))[0]!.state).toBe("suspect");
      expect(await db.select().from(incidents)).toHaveLength(0);

      await recordResult(db, site, fakeResult(false), minutes(1));
      const [opened] = await db.select().from(incidents);
      expect(opened).toMatchObject({ startedAt: minutes(0), resolvedAt: null, causeCode: "HTTP_5XX", failedChecks: 2 });

      await recordResult(db, site, fakeResult(false, "TCP_REFUSED"), minutes(2));
      const [extended] = await db.select().from(incidents);
      expect(extended).toMatchObject({ failedChecks: 3, lastErrorCode: "TCP_REFUSED" });

      const recovered = await recordResult(db, site, fakeResult(true), minutes(3));
      expect(recovered).toMatchObject({ recorded: true, nextCheckAt: minutes(18) });

      const [resolved] = await db.select().from(incidents);
      expect(resolved!.resolvedAt).toEqual(minutes(3));
      const [after] = await db.select().from(sites).where(eq(sites.id, site.id));
      expect(after).toMatchObject({ state: "up", consecutiveFailures: 0, failingSince: null, lastCheckedAt: minutes(3) });

      const timeline = await db.select().from(incidentEvents).orderBy(incidentEvents.at);
      expect(timeline.map((e) => [e.type, e.errorCode])).toEqual([
        ["opened", "HTTP_5XX"],
        ["cause_changed", "TCP_REFUSED"],
        ["resolved", null],
      ]);

      const queued = await db.select().from(notifications);
      expect(queued.map((n) => n.kind).sort()).toEqual(["down", "up"]);
      expect(await db.select().from(checks)).toHaveLength(4);
    });

    it("discards results for sites edited or paused mid-probe", async () => {
      const site = await addSite();
      await db.update(sites).set({ url: "https://changed.example.com/" }).where(eq(sites.id, site.id));
      expect(await recordResult(db, site, fakeResult(false), minutes(0))).toEqual({ recorded: false, reason: "site_changed" });

      const paused = await addSite({ enabled: false });
      expect(await recordResult(db, paused, fakeResult(false), minutes(0))).toEqual({ recorded: false, reason: "site_changed" });

      await db.delete(sites).where(eq(sites.id, site.id));
      expect(await recordResult(db, site, fakeResult(false), minutes(0))).toEqual({ recorded: false, reason: "site_gone" });
      expect(await db.select().from(checks)).toHaveLength(0);
    });
  });

  describe("Worker", () => {
    let server: http.Server;
    let port: number;
    let status = 200;

    beforeAll(async () => {
      server = http.createServer((_req, res) => {
        res.statusCode = status;
        res.end("hello");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterAll(() => server.close());

    it("probes due sites end to end and writes a heartbeat", async () => {
      const site = await addSite({ url: `http://site.test:${port}/`, intervalSec: 300 });
      const worker = new Worker(db, {
        workerId: "test-worker",
        concurrency: 4,
        pollMs: 60_000,
        guard: { allowPrivateCidrs: ["127.0.0.0/8"] },
        probeOptions: { resolver: async () => [{ address: "127.0.0.1", family: 4 }] },
      });

      status = 200;
      expect(await worker.tick()).toBe(1);
      await worker.drain();

      const [check] = await db.select().from(checks).where(eq(checks.siteId, site.id));
      expect(check).toMatchObject({ success: true, httpStatus: 200, resolvedIp: "127.0.0.1" });
      expect(check!.connectMs).not.toBeNull();
      expect(check!.ttfbMs).not.toBeNull();
      const [row] = await db.select().from(sites).where(eq(sites.id, site.id));
      expect(row!.state).toBe("up");
      expect(row!.nextCheckAt.getTime() - row!.lastCheckedAt!.getTime()).toBe(300_000);

      // Not due again yet.
      expect(await worker.tick()).toBe(0);

      await worker.stop();
      const [heartbeat] = await db.select().from(workerHeartbeats);
      expect(heartbeat).toMatchObject({ workerId: "test-worker", checksRun: 1 });
    });

    it("refuses to reach private addresses unless allowed", async () => {
      const site = await addSite({ url: `http://site.test:${port}/` });
      const worker = new Worker(db, {
        workerId: "strict-worker",
        concurrency: 1,
        pollMs: 60_000,
        guard: {},
        probeOptions: { resolver: async () => [{ address: "127.0.0.1", family: 4 }] },
      });
      await worker.tick();
      await worker.drain();
      const [check] = await db.select().from(checks).where(eq(checks.siteId, site.id));
      expect(check).toMatchObject({ success: false, errorCode: "BLOCKED_ADDRESS" });
    });
  });
});
