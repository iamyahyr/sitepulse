import http from "node:http";
import type { AddressInfo } from "node:net";
import { encryptJson, verifyWebhook, type ProbeResult } from "@sitepulse/core";
import {
  alertChannels,
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
import { backoffMs, dispatchOnce, type DispatcherOptions } from "./dispatcher";
import { recordResult } from "./record";

/** See worker.int.test.ts for how to run these locally. */
const url = process.env.TEST_DATABASE_URL;

const OWNER = "test-owner";
const KEY = "test-secret-key-".repeat(3);
const SECRET = "whsec_test";

type Received = { headers: http.IncomingHttpHeaders; body: string; json: { type: string; deliveryId: string } };

describe.skipIf(!url)("alert dispatcher (Postgres integration)", () => {
  let db: Database;
  let server: http.Server;
  let port: number;
  let received: Received[] = [];
  let reply: (res: http.ServerResponse) => void = (res) => res.writeHead(204).end();

  const options = (): DispatcherOptions => ({
    secretKey: KEY,
    appUrl: "https://monitor.example.com",
    postOptions: {
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
      guard: { allowPrivateCidrs: ["127.0.0.0/8"] },
      timeoutMs: 2_000,
    },
  });

  beforeAll(async () => {
    await migrateDatabase(url!);
    db = createDb(url!, { max: 10 });
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body, json: JSON.parse(body) });
        reply(res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server?.close();
    await db?.$client.end();
  });

  beforeEach(async () => {
    received = [];
    reply = (res) => res.writeHead(204).end();
    await db.execute(sql`truncate "user", worker_heartbeats restart identity cascade`);
    await db.insert(user).values({ id: OWNER, name: "Test", email: "owner@sitepulse.test" });
  });

  const fail = (): ProbeResult => ({
    ok: false,
    status: 502,
    errorCode: "HTTP_5XX",
    errorMessage: "HTTP 502",
    timings: { dns: 1, connect: 1, tls: 1, ttfb: 1, download: 1, total: 5 },
    resolvedIp: "93.184.215.14",
    redirects: 0,
    finalUrl: "https://shop.example.com/",
    bodyBytes: 0,
    tlsValidTo: null,
  });
  const ok = (): ProbeResult => ({ ...fail(), ok: true, status: 200, errorCode: null, errorMessage: null });

  /** A site with a webhook channel, taken through an outage until one "down" alert is queued. */
  async function siteWithQueuedAlert(config: object = { type: "webhook", url: `http://hooks.test:${port}/sitepulse`, secret: SECRET }) {
    const [site] = await db
      .insert(sites)
      .values({ ownerId: OWNER, name: "Shop", url: "https://shop.example.com/", nextCheckAt: new Date(0) })
      .returning();
    const [channel] = await db
      .insert(alertChannels)
      .values({ ownerId: OWNER, type: "webhook", name: "hook", configEncrypted: encryptJson(KEY, config) })
      .returning();
    await db.insert(siteAlertChannels).values({ siteId: site!.id, channelId: channel!.id });
    await recordResult(db, site!, fail(), new Date(Date.now() - 120_000));
    await recordResult(db, site!, fail(), new Date(Date.now() - 60_000));
    return site!;
  }

  it("delivers a signed alert once and marks it sent", async () => {
    await siteWithQueuedAlert();

    expect(await dispatchOnce(db, options())).toBe(1);
    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery!.json).toMatchObject({ type: "incident.opened", dashboardUrl: expect.stringMatching(/^https:\/\/monitor\.example\.com\/sites\//) });
    expect(verifyWebhook(SECRET, delivery!.body, String(delivery!.headers["x-sitepulse-signature"]))).toBe(true);

    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: "sent", attempts: 1, lastError: null });
    expect(row!.sentAt).toBeInstanceOf(Date);

    expect(await dispatchOnce(db, options())).toBe(0);
    expect(received).toHaveLength(1);
  });

  it("never sends the same alert twice when dispatchers race", async () => {
    for (let i = 0; i < 4; i++) await siteWithQueuedAlert();
    await Promise.all([dispatchOnce(db, options()), dispatchOnce(db, options()), dispatchOnce(db, options())]);
    expect(received).toHaveLength(4);
    expect(new Set(received.map((r) => r.json.deliveryId)).size).toBe(4);
  });

  it("covers the whole incident: one down alert, one recovery alert", async () => {
    const site = await siteWithQueuedAlert();
    await dispatchOnce(db, options());
    await recordResult(db, site, fail(), new Date(Date.now() - 30_000));
    await recordResult(db, site, ok(), new Date());
    await dispatchOnce(db, options());
    await dispatchOnce(db, options());
    expect(received.map((r) => r.json.type)).toEqual(["incident.opened", "incident.resolved"]);
  });

  it("never lets a recovery alert overtake its outage alert", async () => {
    const site = await siteWithQueuedAlert();
    reply = (res) => res.writeHead(503).end();
    await dispatchOnce(db, options());
    await recordResult(db, site, ok(), new Date());

    // "down" is backing off, so the queued "up" must wait for it.
    reply = (res) => res.writeHead(204).end();
    expect(await dispatchOnce(db, options())).toBe(0);

    const later = new Date(Date.now() + backoffMs(1) + 1_000);
    await dispatchOnce(db, options(), later);
    await dispatchOnce(db, options(), later);
    expect(received.map((r) => r.json.type)).toEqual(["incident.opened", "incident.opened", "incident.resolved"]);
  });

  it("backs off on retryable errors and gives up on permanent ones", async () => {
    await siteWithQueuedAlert();
    reply = (res) => res.writeHead(503).end();
    const before = Date.now();
    await dispatchOnce(db, options());
    let [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "HTTP 503" });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + backoffMs(1));

    // Not due yet: nothing is claimed.
    expect(await dispatchOnce(db, options())).toBe(0);

    reply = (res) => res.writeHead(410).end();
    await dispatchOnce(db, options(), new Date(Date.now() + backoffMs(1) + 1_000));
    [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: "failed", attempts: 2, lastError: "HTTP 410" });
  });

  it("stops after the maximum number of attempts", async () => {
    await siteWithQueuedAlert();
    reply = (res) => res.writeHead(500).end();
    await dispatchOnce(db, { ...options(), maxAttempts: 1 });
    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("fails clearly when the secret key no longer matches", async () => {
    await siteWithQueuedAlert();
    await dispatchOnce(db, { ...options(), secretKey: "another-key-entirely-".repeat(2) });
    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: "failed", lastError: expect.stringContaining("SITEPULSE_SECRET_KEY") });
    expect(received).toHaveLength(0);
  });

  it("refuses webhook URLs on internal networks", async () => {
    await siteWithQueuedAlert({ type: "webhook", url: `http://hooks.test:${port}/x`, secret: SECRET });
    await dispatchOnce(db, { ...options(), postOptions: { ...options().postOptions, guard: {} } });
    const [row] = await db.select().from(notifications);
    expect(row!.status).toBe("failed");
    expect(received).toHaveLength(0);
  });

  it("delivers degradation alerts with the slowed phase", async () => {
    const [site] = await db.insert(sites).values({ ownerId: OWNER, name: "Shop", url: "https://shop.example.com/" }).returning();
    const [channel] = await db
      .insert(alertChannels)
      .values({ ownerId: OWNER, type: "webhook", name: "hook", configEncrypted: encryptJson(KEY, { type: "webhook", url: `http://hooks.test:${port}/x`, secret: SECRET }) })
      .returning();
    const [degradation] = await db
      .insert(siteDegradations)
      .values({ siteId: site!.id, phase: "ttfb", startedAt: new Date(), baselineMs: 150, peakMs: 480 })
      .returning();
    await db.insert(notifications).values({ degradationId: degradation!.id, channelId: channel!.id, kind: "degraded" });

    await dispatchOnce(db, options());
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]!.body)).toMatchObject({
      type: "site.degraded",
      title: "Shop is slowing down: Server response (TTFB) ×3.2",
      degradation: { phase: "ttfb", baselineMs: 150, recentMs: 480 },
    });
    expect((await db.select().from(notifications))[0]!.status).toBe("sent");
  });

  it("drops alerts whose site was deleted", async () => {
    const site = await siteWithQueuedAlert();
    await db.delete(sites).where(eq(sites.id, site.id));
    expect(await dispatchOnce(db, options())).toBe(0);
    expect(received).toHaveLength(0);
  });
});
