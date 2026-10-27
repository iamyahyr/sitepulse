import type { HourBucket } from "@/server/dal/dashboard";

/**
 * One segment per hour, oldest first: green if every check passed, red if any
 * failed, grey without data. Server-rendered SVG, no client JS.
 */
export function UptimeBar({ buckets }: { buckets: HourBucket[] }) {
  return (
    <svg
      viewBox={`0 0 ${buckets.length * 4} 16`}
      className="h-4 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Last ${buckets.length} hours`}
    >
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
