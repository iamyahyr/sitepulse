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

export const PHASES = ["dns", "connect", "tls", "ttfb", "download"] as const;
export type Phase = (typeof PHASES)[number];
export type PhaseSamples = Partial<Record<Phase, readonly number[]>>;
export type PhaseDegradation = Degradation & { phase: Phase };

/**
 * Checks every request phase and reports the one that got worse by the most
 * milliseconds, so the alert can say *where* the time went ("TTFB ×3"), not
 * just that the site is slower.
 */
export function detectPhaseDegradation(
  recent: PhaseSamples,
  baseline: PhaseSamples,
  config: DegradationConfig = DEFAULT_DEGRADATION_CONFIG,
): PhaseDegradation | null {
  let worst: PhaseDegradation | null = null;
  for (const phase of PHASES) {
    const found = detectDegradation(recent[phase] ?? [], baseline[phase] ?? [], config);
    if (!found) continue;
    const delta = found.recentMedianMs - found.baselineMedianMs;
    if (!worst || delta > worst.recentMedianMs - worst.baselineMedianMs) worst = { ...found, phase };
  }
  return worst;
}

/** Below this ratio a degradation counts as over; lower than minRatio so it does not flap. */
export const RECOVERY_RATIO = 1.5;

export function isDegradationOver(recentMedianMs: number | null, baselineMs: number): boolean {
  // No recent successful samples says nothing about speed (the site may be down): keep it open.
  if (recentMedianMs === null) return false;
  return recentMedianMs / Math.max(baselineMs, 1) < RECOVERY_RATIO;
}

export const PHASE_INFO: Record<Phase, { label: string; hint: string }> = {
  dns: { label: "DNS lookup", hint: "The DNS provider is answering slowly." },
  connect: { label: "TCP connect", hint: "The network path or the server's connection handling is slower." },
  tls: { label: "TLS handshake", hint: "TLS termination (proxy/CDN) is struggling, often under CPU load." },
  ttfb: {
    label: "Server response (TTFB)",
    hint: "The application itself is slower: look at slow queries, CPU or memory pressure, cold caches.",
  },
  download: { label: "Download", hint: "Responses got bigger or bandwidth dropped." },
};
