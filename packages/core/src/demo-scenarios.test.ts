import { describe, expect, it } from "vitest";
import { demoBehaviour, demoJitter } from "./demo-scenarios";

const at = (iso: string) => new Date(iso);

describe("demo scenarios", () => {
  it("are deterministic for a given path and minute", () => {
    expect(demoBehaviour("/shop", at("2026-10-27T10:12:30Z"))).toEqual(demoBehaviour("/shop", at("2026-10-27T10:12:01Z")));
    expect(demoJitter("/shop", at("2026-10-27T10:12:00Z"))).not.toBe(demoJitter("/blog", at("2026-10-27T10:12:00Z")));
  });

  it("breaks the shop with a 502 at the top of every 4th hour", () => {
    expect(demoBehaviour("/shop", at("2026-10-27T08:03:00Z"))).toMatchObject({ kind: "status", status: 502 });
    expect(demoBehaviour("/shop", at("2026-10-27T08:05:00Z"))).toMatchObject({ kind: "ok" });
    expect(demoBehaviour("/shop", at("2026-10-27T09:03:00Z"))).toMatchObject({ kind: "ok" });
  });

  it("hangs the API in its window and slows the blog without failing it", () => {
    expect(demoBehaviour("/api/health", at("2026-10-27T07:22:00Z"))).toEqual({ kind: "hang" });
    expect(demoBehaviour("/api/health", at("2026-10-27T07:27:00Z"))).toMatchObject({ kind: "ok" });
    const slow = demoBehaviour("/blog", at("2026-10-27T10:30:00Z"));
    const normal = demoBehaviour("/blog", at("2026-10-27T11:30:00Z"));
    expect(slow).toMatchObject({ kind: "ok" });
    expect((slow as { delayMs: number }).delayMs).toBeGreaterThan(4 * (normal as { delayMs: number }).delayMs);
  });

  it("returns null for unknown paths", () => {
    expect(demoBehaviour("/nope", new Date())).toBeNull();
  });
});
