import type { AddressInfo } from "node:net";
import { probe, type ProbeOptions } from "@sitepulse/core";
import { afterEach, describe, expect, it } from "vitest";
import { createFlakyServer } from "./server";

/** Each scenario, exercised end to end with SitePulse's real prober. */
describe("flaky server", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await close?.();
    close = null;
  });

  async function start(at: string) {
    const flaky = createFlakyServer(() => new Date(at));
    close = flaky.close;
    await new Promise<void>((resolve) => flaky.server.listen(0, "127.0.0.1", resolve));
    return `http://flaky.test:${(flaky.server.address() as AddressInfo).port}`;
  }

  const options: ProbeOptions = {
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    guard: { allowPrivateCidrs: ["127.0.0.0/8"] },
    timeoutMs: 1_500,
  };

  it("serves the shop normally outside its outage window", async () => {
    const base = await start("2026-10-27T09:30:00Z");
    const result = await probe(`${base}/shop`, options);
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(result.timings.ttfb).toBeGreaterThanOrEqual(200);
  });

  it("answers 502 during the shop outage", async () => {
    const base = await start("2026-10-27T08:02:00Z");
    expect(await probe(`${base}/shop`, options)).toMatchObject({ ok: false, status: 502, errorCode: "HTTP_5XX" });
  });

  it("hangs the API so the prober reports a TTFB timeout", async () => {
    const base = await start("2026-10-27T07:22:00Z");
    const result = await probe(`${base}/api/health`, options);
    expect(result.errorCode).toBe("TTFB_TIMEOUT");
    expect(result.timings.connect).not.toBeNull();
  });

  it("slows the blog down without failing it", async () => {
    const base = await start("2026-10-27T10:30:00Z");
    const result = await probe(`${base}/blog`, options);
    expect(result.ok).toBe(true);
    expect(result.timings.ttfb).toBeGreaterThanOrEqual(400);
  });

  it("lists its scenarios on / and 404s elsewhere", async () => {
    const base = await start("2026-10-27T10:30:00Z");
    const index = (await fetch(`http://127.0.0.1:${new URL(base).port}/`).then((r) => r.json())) as { path: string }[];
    expect(index.map((s) => s.path)).toContain("/shop");
    expect((await fetch(`http://127.0.0.1:${new URL(base).port}/nope`)).status).toBe(404);
  });
});
