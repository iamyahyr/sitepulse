/**
 * Early warning before an outage: compares the recent median of a phase
 * (e.g. TTFB) against its baseline and flags a sustained, meaningful jump.
 * Both a ratio and an absolute floor are required so that 5 ms → 20 ms does
 * not page anyone.
 */

export type DegradationConfig = {
  minRatio: number;
  minDeltaMs: number;
  minRecentSamples: number;
  minBaselineSamples: number;
};

export const DEFAULT_DEGRADATION_CONFIG: DegradationConfig = {
  minRatio: 2.5,
  minDeltaMs: 200,
  minRecentSamples: 4,
  minBaselineSamples: 20,
};

export type Degradation = { recentMedianMs: number; baselineMedianMs: number; ratio: number };

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function detectDegradation(
  recent: readonly number[],
  baseline: readonly number[],
  config: DegradationConfig = DEFAULT_DEGRADATION_CONFIG,
): Degradation | null {
  if (recent.length < config.minRecentSamples || baseline.length < config.minBaselineSamples) return null;
  const recentMedianMs = median(recent)!;
  const baselineMedianMs = Math.max(median(baseline)!, 1);
  const ratio = recentMedianMs / baselineMedianMs;
  if (ratio < config.minRatio || recentMedianMs - baselineMedianMs < config.minDeltaMs) return null;
  return { recentMedianMs, baselineMedianMs, ratio };
}
