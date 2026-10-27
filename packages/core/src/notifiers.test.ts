import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discordPayload, isDiscordWebhookUrl, sendAlert, webhookPayload, type AlertEvent } from "./notifiers";
import { safePost } from "./outbound";
import type { Resolver } from "./probe";
import { decryptJson, encryptJson, signWebhook, verifyWebhook } from "./secrets";

const KEY = "k".repeat(40);
const loopback: Resolver = async () => [{ address: "127.0.0.1", family: 4 }];
const allowLoopback = { resolver: loopback, guard: { allowPrivateCidrs: ["127.0.0.0/8"] }, timeoutMs: 2_000 };

const downEvent: AlertEvent = {
  kind: "down",
  deliveryId: "delivery-1",
  site: { id: "site-1", name: "Shop @everyone", url: "https://shop.example.com/" },
  incident: {
    id: "inc-1",
    startedAt: new Date("2026-10-27T12:00:00Z"),
    resolvedAt: null,
    cause: "HTTP_5XX",
    lastErrorMessage: "HTTP 502",
    httpStatus: 502,
  },
  dashboardUrl: "https://monitor.example.com/sites/site-1",
};

describe("secrets", () => {
  it("round-trips encrypted JSON and uses a fresh IV each time", () => {
    const a = encryptJson(KEY, { url: "https://x.test/hook" });
    const b = encryptJson(KEY, { url: "https://x.test/hook" });
    expect(a).not.toBe(b);
    expect(decryptJson(KEY, a)).toEqual({ url: "https://x.test/hook" });
  });

  it("rejects tampered ciphertexts and wrong keys", () => {
    const sealed = encryptJson(KEY, { secret: 1 });
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptJson(KEY, parts.join("."))).toThrow();
    expect(() => decryptJson("z".repeat(40), sealed)).toThrow();
  });

  it("refuses short keys", () => {
    expect(() => encryptJson("short", {})).toThrow(/at least 32/);
  });

  it("signs and verifies webhooks, rejecting tampering and replays", () => {
    const body = '{"hello":"world"}';
    const header = signWebhook("whsec_test", body, 1_800_000_000);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook("whsec_test", body, header, { now: 1_800_000_010 })).toBe(true);
    expect(verifyWebhook("whsec_test", body + " ", header, { now: 1_800_000_010 })).toBe(false);
    expect(verifyWebhook("whsec_other", body, header, { now: 1_800_000_010 })).toBe(false);
    expect(verifyWebhook("whsec_test", body, header, { now: 1_800_001_000 })).toBe(false);
  });
});

describe("payloads", () => {
  it("only accepts real Discord webhook URLs", () => {
    expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/123/abc-DEF_9")).toBe(true);
    expect(isDiscordWebhookUrl("https://canary.discord.com/api/webhooks/123/abc")).toBe(true);
    expect(isDiscordWebhookUrl("http://discord.com/api/webhooks/123/abc")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com.evil.test/api/webhooks/123/abc")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com/channels/123")).toBe(false);
  });

  it("builds a Discord embed that cannot ping anyone", () => {
    const payload = discordPayload(downEvent);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0]!.title).toBe("🔴 Shop @everyone is down");
    expect(payload.embeds[0]!.description).toContain("Bad gateway");
  });

  it("describes recoveries with their duration", () => {
    const up: AlertEvent = {
      ...downEvent,
      kind: "up",
      incident: { ...downEvent.incident!, resolvedAt: new Date("2026-10-27T13:30:00Z") },
    };
    expect(webhookPayload(up)).toMatchObject({
      type: "incident.resolved",
      title: "Shop @everyone recovered after 1 h 30 min",
      incident: { durationSec: 5400 },
    });
  });
});

describe("delivery", () => {
  let server: http.Server;
  let port: number;
  let respond: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void = (_q, res) => res.end();
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        respond(req, res, body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => server.close());

  it("posts signed webhooks that the reference verifier accepts", async () => {
    respond = (_q, res) => res.writeHead(204).end();
    const result = await sendAlert({ type: "webhook", url: `http://hooks.test:${port}/in`, secret: "whsec_abc" }, downEvent, allowLoopback);
    expect(result).toEqual({ ok: true, status: 204 });

    const last = received.at(-1)!;
    expect(last.headers["x-sitepulse-event"]).toBe("incident.opened");
    expect(last.headers["x-sitepulse-delivery"]).toBe("delivery-1");
    expect(verifyWebhook("whsec_abc", last.body, String(last.headers["x-sitepulse-signature"]))).toBe(true);
    expect(JSON.parse(last.body)).toMatchObject({ type: "incident.opened", site: { id: "site-1" } });
  });

  it("classifies failures as retryable or not", async () => {
    respond = (_q, res) => res.writeHead(503, { "retry-after": "120" }).end();
    expect(await safePost(`http://hooks.test:${port}/`, "{}", {}, allowLoopback)).toMatchObject({
      ok: false,
      status: 503,
      retryable: true,
      retryAfterSec: 120,
    });

    respond = (_q, res) => res.writeHead(404).end();
    expect(await safePost(`http://hooks.test:${port}/`, "{}", {}, allowLoopback)).toMatchObject({ ok: false, retryable: false });

    respond = (_q, res) => res.writeHead(302, { location: "http://169.254.169.254/" }).end();
    expect(await safePost(`http://hooks.test:${port}/`, "{}", {}, allowLoopback)).toMatchObject({
      ok: false,
      retryable: false,
      error: expect.stringContaining("redirects are not followed"),
    });
  });

  it("refuses webhook URLs that point at internal networks", async () => {
    const before = received.length;
    expect(await safePost(`http://127.0.0.1:${port}/`, "{}", {})).toMatchObject({ ok: false, retryable: false });
    expect(await safePost(`http://hooks.test:${port}/`, "{}", {}, { resolver: loopback })).toMatchObject({
      ok: false,
      retryable: false,
    });
    expect(received.length).toBe(before);
  });

  it("times out slow receivers as retryable", async () => {
    respond = () => {};
    expect(await safePost(`http://hooks.test:${port}/`, "{}", {}, { ...allowLoopback, timeoutMs: 300 })).toMatchObject({
      ok: false,
      retryable: true,
    });
  });
});
