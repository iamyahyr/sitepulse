/**
 * Honest uptime.
 *
 * Uptime is time-weighted: the share of the observed window not covered by an
 * incident. It is *not* "successful checks / total checks", which would let a
 * 2-hour outage checked every 15 min weigh the same as a blip. Time before the
 * site was first monitored is excluded rather than counted as up.
 */

export type Interval = { start: Date; end: Date | null };

export type UptimeReport = {
  /** 0..1, or null when nothing was observed in the window. */
  ratio: number | null;
  downtimeMs: number;
  observedMs: number;
};

export function computeUptime(
  incidents: readonly Interval[],
  window: { from: Date; to: Date },
  monitoredSince: Date,
): UptimeReport {
  const from = Math.max(window.from.getTime(), monitoredSince.getTime());
  const to = window.to.getTime();
  const observedMs = Math.max(0, to - from);
  if (observedMs === 0) return { ratio: null, downtimeMs: 0, observedMs: 0 };

  const clipped = incidents
    .map(({ start, end }) => [Math.max(start.getTime(), from), Math.min(end?.getTime() ?? to, to)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  let downtimeMs = 0;
  let cursor = from;
  for (const [s, e] of clipped) {
    const start = Math.max(s, cursor);
    if (e > start) {
      downtimeMs += e - start;
      cursor = e;
    }
  }

  return { ratio: 1 - downtimeMs / observedMs, downtimeMs, observedMs };
}

/** Formats a ratio without rounding a real outage up to 100%. */
export function formatUptime(ratio: number | null): string {
  if (ratio === null) return "—";
  if (ratio >= 1) return "100%";
  const floored = Math.floor(ratio * 10_000) / 100;
  return `${floored.toFixed(2)}%`;
}
