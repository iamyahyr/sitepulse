import { PHASE_INFO } from "@sitepulse/core";
import { Gauge } from "lucide-react";
import Link from "next/link";
import { relativeTime } from "@/lib/format";
import type { Degradation } from "@/server/dal/sites";

/** "Slower than usual" early warning: the site is up, but one phase is well above its own 7-day median. */
export function DegradationNotice({
  degradation,
  now,
  site,
}: {
  degradation: Degradation;
  now: Date;
  site?: { id: string; name: string };
}) {
  const info = PHASE_INFO[degradation.phase];
  const ratio = degradation.peakMs / Math.max(degradation.baselineMs, 1);

  return (
    <div role="status" className="border-suspect/50 bg-suspect/10 flex gap-3 rounded-xl border px-5 py-4">
      <Gauge className="text-suspect mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="text-sm leading-relaxed">
        <p className="font-semibold">
          {site ? (
            <Link href={`/sites/${site.id}`} className="hover:underline">
              {site.name}
            </Link>
          ) : (
            "This site"
          )}{" "}
          is slower than usual: {info.label} ×{ratio.toFixed(1)}
        </p>
        <p className="text-muted mt-1">
          Up to {Math.round(degradation.peakMs)} ms instead of the usual {Math.round(degradation.baselineMs)} ms, since{" "}
          {relativeTime(degradation.startedAt, now)}. The site still responds. {info.hint}
        </p>
      </div>
    </div>
  );
}
