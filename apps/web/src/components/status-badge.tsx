import type { SiteState } from "@sitepulse/core";

const LABELS: Record<SiteState, string> = {
  up: "Operational",
  suspect: "Checking",
  down: "Down",
  unknown: "No recent data",
};

const COLORS: Record<SiteState, string> = {
  up: "bg-up",
  suspect: "bg-suspect",
  down: "bg-down",
  unknown: "bg-unknown",
};

export function StatusDot({ state }: { state: SiteState }) {
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      {state === "down" && <span className={`${COLORS[state]} absolute inset-0 animate-ping rounded-full opacity-60`} />}
      <span className={`${COLORS[state]} relative inline-flex size-2.5 rounded-full`} />
    </span>
  );
}

export function StatusBadge({ state }: { state: SiteState }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <StatusDot state={state} />
      {LABELS[state]}
    </span>
  );
}
