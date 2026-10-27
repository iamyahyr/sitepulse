import type { Phases } from "@/lib/mock";

export const PHASES = [
  { key: "dns", label: "DNS", color: "bg-phase-dns" },
  { key: "connect", label: "TCP connect", color: "bg-phase-connect" },
  { key: "tls", label: "TLS handshake", color: "bg-phase-tls" },
  { key: "ttfb", label: "Server (TTFB)", color: "bg-phase-ttfb" },
  { key: "download", label: "Download", color: "bg-phase-download" },
] as const;

/**
 * DevTools-style waterfall of a single check. A phase that never completed is
 * drawn hatched, which is exactly where the request broke.
 */
export function PhaseWaterfall({ phases, failedAt }: { phases: Phases; failedAt?: keyof Phases }) {
  const total = Math.max(1, PHASES.reduce((sum, p) => sum + phases[p.key], 0));
  const starts = PHASES.map((_, i) => PHASES.slice(0, i).reduce((sum, p) => sum + phases[p.key], 0));

  return (
    <div className="space-y-1.5 font-mono text-xs">
      {PHASES.map(({ key, label, color }, i) => {
        const value = phases[key];
        const left = (starts[i]! / total) * 100;
        const broken = key === failedAt;
        return (
          <div key={key} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-3">
            <span className={broken ? "text-down font-semibold" : "text-muted"}>{label}</span>
            <div className="bg-surface-muted relative h-3 rounded-sm">
              {broken ? (
                <div
                  className="border-down absolute inset-y-0 right-0 rounded-sm border border-dashed bg-[repeating-linear-gradient(45deg,var(--down)_0_2px,transparent_2px_6px)] opacity-70"
                  style={{ left: `${left}%` }}
                />
              ) : (
                value > 0 && (
                  <div
                    className={`${color} absolute inset-y-0 rounded-sm`}
                    style={{ left: `${left}%`, width: `max(${(value / total) * 100}%, 2px)` }}
                  />
                )
              )}
            </div>
            <span className="text-right tabular-nums">{broken ? "✕" : value > 0 ? `${value} ms` : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}
