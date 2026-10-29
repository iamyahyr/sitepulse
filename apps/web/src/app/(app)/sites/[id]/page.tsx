import { diagnose, type ErrorCode } from "@sitepulse/core";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/card";
import { DegradationNotice } from "@/components/degradation-notice";
import { LatencyChart, type LatencyPoint } from "@/components/latency-chart";
import { LiveRefresh } from "@/components/live-refresh";
import { PhaseWaterfall } from "@/components/phase-waterfall";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui";
import { brokenPhase, chartPhases, checkPhases, intervalLabel } from "@/lib/checks";
import { clockTime, duration, ms, relativeTime } from "@/lib/format";
import { listIncidents } from "@/server/dal/incidents";
import { liveFingerprint } from "@/server/dal/live";
import { getSite, openDegradations, recentChecks, siteRollups, successfulChecksSince } from "@/server/dal/sites";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Site · SitePulse" };

const DAY = 24 * 3_600_000;

const RANGES = {
  "24h": { label: "24 h", days: 1 },
  "7d": { label: "7 days", days: 7 },
  "30d": { label: "30 days", days: 30 },
} as const;
type Range = keyof typeof RANGES;

export default async function SitePage({ params, searchParams }: PageProps<"/sites/[id]">) {
  const { id } = await params;
  const rangeParam = (await searchParams).range;
  const range: Range = typeof rangeParam === "string" && rangeParam in RANGES ? (rangeParam as Range) : "24h";
  const user = await requireUser();
  const live = await liveFingerprint(user.id, { site: id });
  const site = await getSite(user.id, id);
  if (!site) notFound();

  const now = new Date();
  const from = new Date(now.getTime() - RANGES[range].days * DAY);
  const [checks, { rows: incidents }, dayChecks, rollups, degradations] = await Promise.all([
    recentChecks(site.id, 12),
    listIncidents(user.id, { status: "all", siteId: site.id }, 10),
    range === "24h" ? successfulChecksSince(site.id, from) : Promise.resolve([]),
    range === "24h" ? Promise.resolve([]) : siteRollups(site.id, from),
    openDegradations([site.id]),
  ]);
  const latest = checks[0];
  const degradation = degradations.get(site.id);
  // 24 h: every raw check. 7/30 days: hourly medians from the rollups, so the
  // chart stays fast and survives raw-check retention.
  const chartData: LatencyPoint[] =
    range === "24h"
      ? dayChecks.map((c) => ({ t: c.checkedAt.getTime(), ...chartPhases(c) }))
      : rollups
          .filter((r) => r.ok > 0)
          .map((r) => ({
            t: r.hour.getTime(),
            dns: Math.round(r.p50DnsMs ?? 0),
            connect: Math.round(r.p50ConnectMs ?? 0),
            tls: Math.round(r.p50TlsMs ?? 0),
            ttfb: Math.round(r.p50TtfbMs ?? 0),
            download: Math.round(r.p50DownloadMs ?? 0),
          }));
  const tlsDays = site.tlsExpiresAt ? Math.floor((site.tlsExpiresAt.getTime() - now.getTime()) / DAY) : null;
  const latestDiagnosis = latest && !latest.success && latest.errorCode ? diagnose(latest.errorCode as ErrorCode, latest.httpStatus) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
            {site.enabled ? <StatusBadge state={site.state} /> : <span className="text-muted text-sm">Paused</span>}
            <LiveRefresh since={live} scope={{ site: id }} />
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
        {!env().DEMO_MODE && (
          <Link href={`/sites/${site.id}/edit`} className={buttonClass("secondary")}>
            <Pencil className="size-4" aria-hidden />
            Edit
          </Link>
        )}
      </div>

      {degradation && <DegradationNotice degradation={degradation} now={now} />}

      {!latest ? (
        <Card title="Checks">
          <EmptyState title="Waiting for the first check">
            {site.enabled ? (
              <>
                <Loader2 className="mx-auto my-3 size-5 animate-spin" aria-hidden />
                <p>The worker picks up new sites within a minute. Make sure the worker process is running.</p>
                <p className="mt-1">This page updates on its own as soon as it lands.</p>
              </>
            ) : (
              "Monitoring is paused for this site."
            )}
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
              <PhaseWaterfall
                phases={checkPhases(latest)}
                failedAt={latest.success ? undefined : brokenPhase(latest.errorCode)}
                totalMs={latest.totalMs}
              />
            </div>
          </Card>

          <Card
            title={range === "24h" ? "Response time by phase, every check" : "Response time by phase, hourly median"}
            action={
              <nav aria-label="Time range" className="flex gap-1">
                {(Object.keys(RANGES) as Range[]).map((key) => (
                  <Link
                    key={key}
                    href={key === "24h" ? `/sites/${site.id}` : `/sites/${site.id}?range=${key}`}
                    aria-current={key === range ? "page" : undefined}
                    scroll={false}
                    className={`rounded-md px-2 py-1 text-xs ${key === range ? "bg-surface-muted font-medium" : "text-muted hover:text-foreground"}`}
                  >
                    {RANGES[key].label}
                  </Link>
                ))}
              </nav>
            }
          >
            {chartData.length > 1 ? (
              <LatencyChart data={chartData} span={range === "24h" ? "day" : "multiday"} />
            ) : (
              <EmptyState title={range === "24h" ? "Not enough successful checks yet" : "No hourly data yet"}>
                {range !== "24h" && "Hourly medians are computed by the worker a few minutes after each hour ends."}
              </EmptyState>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Recent checks">
              <ul className="-my-2 text-sm">
                {checks.map((check) => (
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

            <Card
              title="Incidents"
              action={
                incidents.length > 0 && (
                  <Link href={`/incidents?site=${site.id}`} className="text-muted hover:text-foreground text-xs">
                    View all
                  </Link>
                )
              }
            >
              {incidents.length === 0 ? (
                <EmptyState title="No incidents recorded" />
              ) : (
                <ul className="-my-2 text-sm">
                  {incidents.map(({ incident, openingStatus }) => (
                    <li key={incident.id} className="border-border border-b py-2.5 last:border-0">
                      <div className="flex items-center justify-between gap-3">
                        <Link href={`/incidents/${incident.id}`} className="font-medium hover:underline">
                          {diagnose(incident.causeCode as ErrorCode, openingStatus).title}
                        </Link>
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
