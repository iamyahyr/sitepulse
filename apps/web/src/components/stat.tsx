/** A headline number with its label, as used across the dashboard and incidents pages. */
export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" }) {
  return (
    <div className="border-border bg-surface rounded-xl border px-5 py-4">
      <p className="text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "down" ? "text-down" : tone === "up" ? "text-up" : ""}`}
      >
        {value}
      </p>
      {hint && <p className="text-muted mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}
