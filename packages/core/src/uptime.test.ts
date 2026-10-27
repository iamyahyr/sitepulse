import { describe, expect, it } from "vitest";
import { detectDegradation, median } from "./degradation";
import { matchesExpectedStatus, parseExpectedStatus } from "./status";
import { computeUptime, formatUptime } from "./uptime";

const h = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const day = { from: h(0), to: h(24) };

describe("computeUptime", () => {
  it("is 100% with no incidents", () => {
    expect(computeUptime([], day, h(0))).toEqual({ ratio: 1, downtimeMs: 0, observedMs: 24 * 3600_000 });
  });

  it("weights by time, not by number of checks", () => {
    const report = computeUptime([{ start: h(10), end: h(16) }], day, h(0));
    expect(report.ratio).toBe(0.75);
  });

  it("clips incidents to the window and counts open ones until the end", () => {
    const report = computeUptime(
      [
        { start: new Date(Date.UTC(2026, 8, 30, 22)), end: h(2) },
        { start: h(22), end: null },
      ],
      day,
      h(0),
    );
    expect(report.downtimeMs).toBe(4 * 3600_000);
  });

  it("does not double count overlapping incidents", () => {
    const report = computeUptime(
      [
        { start: h(1), end: h(3) },
        { start: h(2), end: h(4) },
      ],
      day,
      h(0),
    );
    expect(report.downtimeMs).toBe(3 * 3600_000);
  });

  it("excludes time before monitoring began", () => {
    const report = computeUptime([{ start: h(18), end: h(21) }], day, h(12));
    expect(report.observedMs).toBe(12 * 3600_000);
    expect(report.ratio).toBe(0.75);
  });

  it("returns null when nothing was observed", () => {
    expect(computeUptime([], day, h(30)).ratio).toBeNull();
  });
});

describe("formatUptime", () => {
  it("never rounds a real outage up to 100%", () => {
    expect(formatUptime(0.999999)).toBe("99.99%");
    expect(formatUptime(1)).toBe("100%");
    expect(formatUptime(0.98765)).toBe("98.76%");
    expect(formatUptime(null)).toBe("—");
  });
});

describe("expected status", () => {
  it("parses ranges and lists", () => {
    expect(parseExpectedStatus("200-399")).toEqual([[200, 399]]);
    expect(parseExpectedStatus("200, 204,300-302")).toEqual([[200, 200], [204, 204], [300, 302]]);
    expect(parseExpectedStatus("abc")).toBeNull();
    expect(parseExpectedStatus("399-200")).toBeNull();
    expect(parseExpectedStatus("700")).toBeNull();
  });

  it("matches and falls back to the default for bad expressions", () => {
    expect(matchesExpectedStatus(204, "200,204")).toBe(true);
    expect(matchesExpectedStatus(404, "200-399")).toBe(false);
    expect(matchesExpectedStatus(301, "garbage")).toBe(true);
  });
});

describe("detectDegradation", () => {
  const baseline = Array.from({ length: 30 }, (_, i) => 100 + (i % 5));

  it("flags a sustained jump", () => {
    const result = detectDegradation([420, 450, 400, 470], baseline);
    expect(result).not.toBeNull();
    expect(result!.ratio).toBeGreaterThan(4);
  });

  it("ignores small absolute changes and thin samples", () => {
    expect(detectDegradation([5, 6, 5, 6], Array(30).fill(1))).toBeNull();
    expect(detectDegradation([900, 900], baseline)).toBeNull();
    expect(detectDegradation([900, 900, 900, 900], baseline.slice(0, 5))).toBeNull();
  });

  it("computes medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
