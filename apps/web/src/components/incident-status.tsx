import { StatusDot } from "@/components/status-badge";

/** Ongoing, recovered, or closed by hand (monitoring paused or URL changed): the last two are not the same thing. */
export function IncidentStatus({ resolvedAt, closedManually }: { resolvedAt: Date | null; closedManually: boolean }) {
  if (!resolvedAt) {
    return (
      <span className="text-down inline-flex items-center gap-2 font-medium">
        <StatusDot state="down" />
        Ongoing
      </span>
    );
  }
  if (closedManually) {
    return (
      <span className="text-muted inline-flex items-center gap-2" title="Monitoring was paused or the URL changed">
        <StatusDot state="unknown" />
        Closed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot state="up" />
      Recovered
    </span>
  );
}
