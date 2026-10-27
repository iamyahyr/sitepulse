import { diagnose, type ErrorCode } from "@sitepulse/core";
import { ExternalLink, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/card";
import { LatencyChart, type LatencyPoint } from "@/components/latency-chart";
import { PhaseWaterfall } from "@/components/phase-waterfall";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui";
import { brokenPhase, checkPhases, intervalLabel } from "@/lib/checks";
import { clockTime, duration, ms, relativeTime } from "@/lib/format";
import { getSite, recentChecks, siteIncidents } from "@/server/dal/sites";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Site · SitePulse" };

const DAY = 24 * 3_600_000;

export default async function SitePage({ params }: PageProps<"/sites/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const site = await getSite(user.id, id);
  if (!site) notFound();

  const [checks, incidents] = await Promise.all([recentChecks(site.id, 300), siteIncidents(site.id)]);
  const now = new Date();
  const latest = checks[0];
  const chartData: LatencyPoint[] = checks
    .filter((c) => c.success && now.getTime() - c.checkedAt.getTime() <= DAY)
    .reverse()
    .map((c) => ({ t: c.checkedAt.getTime(), ...checkPhases(c) }));
  const tlsDays = site.tlsExpiresAt ? Math.floor((site.tlsExpiresAt.getTime() - now.getTime()) / DAY) : null;
  const latestDiagnosis = latest && !latest.success && latest.errorCode ? diagnose(latest.errorCode as ErrorCode, latest.httpStatus) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
            {site.enabled ? <StatusBadge state={site.state} /> : <span className="text-muted text-sm">Paused</span>}
          </div>
          <a
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-foreground mt-1 inline-flex max-w-full items-center gap-1 font-mono text-sm break-all"
          >
            {site.url}
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </a>
          <p className="text-muted mt-2 text-sm">
            {[
              site.client,
              `every ${intervalLabel(site.intervalSec)}`,
              `timeout ${site.timeoutMs / 1000} s`,
              `expects ${site.expectedStatus}`,
              tlsDays !== null && `certificate expires in ${tlsDays} d`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Link href={`/sites/${site.id}/edit`} className={buttonClass("secondary")}>
          <Pencil className="size-4" aria-hidden />
          Edit
        </Link>
      </div>

      {!latest ? (
        <Card title="Checks">
          <EmptyState title="Waiting for the first check">
            {site.enabled
              ? "The worker picks up new sites within a minute. Make sure the worker process is running."
              : "Monitoring is paused for this site."}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card
            title="Anatomy of the latest check"
            action={<span className="text-muted text-xs">{relativeTime(latest.checkedAt, now)}</span>}
          >
            <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
              <div>
                {latestDiagnosis ? (
                  <>
                    <p className="text-muted font-mono text-xs uppercase">
                      {latestDiagnosis.layer} layer · {latest.httpStatus ? `HTTP ${latest.httpStatus}` : latest.errorCode}
                    </p>
                    <h3 className="text-down mt-1 text-lg font-semibold">{latestDiagnosis.title}</h3>
                    <p className="text-muted mt-2 text-sm leading-relaxed">{latestDiagnosis.hint}</p>
                    {latest.errorMessage && <p className="text-muted mt-3 font-mono text-xs break-all">{latest.errorMessage}</p>}
                  </>
                ) : (
                  <>
                    <p className="text-muted font-mono text-xs uppercase">HTTP {latest.httpStatus}</p>
                    <h3 className="text-up mt-1 text-lg font-semibold">Responded in {ms(latest.totalMs)}</h3>
                    <p className="text-muted mt-2 text-sm">
                      Resolved to <span className="font-mono">{latest.resolvedIp}</span>
                      {latest.redirectCount > 0 && ` after ${latest.redirectCount} redirect(s)`}.
                    </p>
                  </>
                )}
              </div>
              <PhaseWaterfall phases={checkPhases(latest)} failedAt={latest.success ? undefined : brokenPhase(latest.errorCode)} />
            </div>
          </Card>

          <Card title="Response time by phase, last 24 h">
            {chartData.length > 1 ? (
              <LatencyChart data={chartData} />
            ) : (
              <EmptyState title="Not enough successful checks yet" />
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Recent checks">
              <ul className="-my-2 text-sm">
                {checks.slice(0, 12).map((check) => (
                  <li key={check.id} className="border-border flex items-center gap-3 border-b py-2 last:border-0">
                    <span className={`size-2 shrink-0 rounded-full ${check.success ? "bg-up" : "bg-down"}`} />
                    <span className="text-muted w-20 font-mono text-xs">{clockTime(check.checkedAt)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {check.success
                        ? `HTTP ${check.httpStatus}`
                        : diagnose((check.errorCode ?? "UNKNOWN") as ErrorCode, check.httpStatus).title}
                    </span>
                    <span className="font-mono text-xs tabular-nums">{ms(check.totalMs)}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Incidents">
              {incidents.length === 0 ? (
                <EmptyState title="No incidents recorded" />
              ) : (
                <ul className="-my-2 text-sm">
                  {incidents.map((incident) => (
                    <li key={incident.id} className="border-border border-b py-2.5 last:border-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{diagnose(incident.causeCode as ErrorCode).title}</span>
                        <span className={`text-xs ${incident.resolvedAt ? "text-muted" : "text-down font-medium"}`}>
                          {incident.resolvedAt
                            ? duration(incident.resolvedAt.getTime() - incident.startedAt.getTime())
                            : "Ongoing"}
                        </span>
                      </div>
                      <p className="text-muted mt-0.5 text-xs">Started {relativeTime(incident.startedAt, now)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
