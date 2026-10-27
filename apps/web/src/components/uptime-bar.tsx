import type { MockCheck } from "@/lib/mock";

/**
 * One segment per hour: green if every check passed, red if any failed.
 * Server-rendered SVG, no client JS.
 */
export function UptimeBar({ checks, hours = 48 }: { checks: MockCheck[]; hours?: number }) {
  const last = checks.at(-1)?.at.getTime() ?? 0;
  const buckets = Array.from({ length: hours }, () => ({ total: 0, failed: 0 }));
  for (const check of checks) {
    const index = hours - 1 - Math.floor((last - check.at.getTime()) / 3_600_000);
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.total++;
    if (!check.ok) bucket.failed++;
  }

  return (
    <svg viewBox={`0 0 ${hours * 4} 16`} className="h-4 w-full" preserveAspectRatio="none" role="img" aria-label={`Last ${hours} hours`}>
      {buckets.map((b, i) => (
        <rect
          key={i}
          x={i * 4}
          y={0}
          width={3}
          height={16}
          rx={1}
          className={b.total === 0 ? "fill-unknown/40" : b.failed > 0 ? "fill-down" : "fill-up/80"}
        >
          <title>{b.total === 0 ? "No data" : `${b.total - b.failed}/${b.total} checks OK`}</title>
        </rect>
      ))}
    </svg>
  );
}
