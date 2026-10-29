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

  const downtimeMs = total(downSpans(incidents, from, to));
  return { ratio: 1 - downtimeMs / observedMs, downtimeMs, observedMs };
}

const HOUR_MS = 3_600_000;

/**
 * Uptime of a past window, where `monitoredSince` no longer says when the site
 * was watched (it moves on every URL change and resume). Only the hours that
 * have at least one recorded check count as observed, so time spent paused,
 * not yet created or with the monitor itself offline is excluded, never
 * credited as "up".
 */
export function computeObservedUptime(
  incidents: readonly Interval[],
  observedHours: readonly Date[],
  window: { from: Date; to: Date },
): UptimeReport {
  const from = window.from.getTime();
  const to = window.to.getTime();
  const observed = merge(observedHours.map((hour) => [hour.getTime(), hour.getTime() + HOUR_MS] as const), from, to);
  const observedMs = total(observed);
  if (observedMs === 0) return { ratio: null, downtimeMs: 0, observedMs: 0 };

  const down = downSpans(incidents, from, to);
  let downtimeMs = 0;
  for (let i = 0, j = 0; i < observed.length && j < down.length; ) {
    const start = Math.max(observed[i]![0], down[j]![0]);
    const end = Math.min(observed[i]![1], down[j]![1]);
    if (end > start) downtimeMs += end - start;
    if (observed[i]![1] < down[j]![1]) i++;
    else j++;
  }
  return { ratio: 1 - downtimeMs / observedMs, downtimeMs, observedMs };
}

type Span = readonly [start: number, end: number];

/** Incidents as disjoint spans inside [from, to]; open ones last until `to`. */
function downSpans(incidents: readonly Interval[], from: number, to: number): Span[] {
  return merge(
    incidents.map(({ start, end }) => [start.getTime(), end?.getTime() ?? to] as const),
    from,
    to,
  );
}

/** Clips spans to [from, to] and merges the ones that overlap or touch. */
function merge(spans: readonly Span[], from: number, to: number): Span[] {
  const sorted = spans
    .map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

const total = (spans: readonly Span[]) => spans.reduce((sum, [s, e]) => sum + e - s, 0);

/** Formats a ratio without rounding a real outage up to 100%. */
export function formatUptime(ratio: number | null): string {
  if (ratio === null) return "—";
  if (ratio >= 1) return "100%";
  const floored = Math.floor(ratio * 10_000) / 100;
  return `${floored.toFixed(2)}%`;
}
