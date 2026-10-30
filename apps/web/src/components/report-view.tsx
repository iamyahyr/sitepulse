import { diagnose, formatUptime, type ErrorCode } from "@sitepulse/core";
import { Card, EmptyState } from "@/components/card";
import { LatencyChart } from "@/components/latency-chart";
import { Stat } from "@/components/stat";
import { dateTime, duration, ms } from "@/lib/format";
import type { MonthlyReport, ReportDay, ReportTotals } from "@/server/dal/reports";

export const clientLabel = (client: string | null) => client ?? "Sites without a client";

const DAY_LABEL = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** "▲ 0.12 pp vs last month" (percentage points for ratios). */
function delta(current: number | null, previous: number | null, unit: "pp" | "count") {
  if (current === null || previous === null) return undefined;
  const diff = unit === "pp" ? (current - previous) * 100 : current - previous;
  if (Math.abs(diff) < (unit === "pp" ? 0.005 : 1)) return "same as last month";
  const amount = unit === "pp" ? `${Math.abs(diff).toFixed(2)} pp` : String(Math.abs(diff));
  return `${diff > 0 ? "▲" : "▼"} ${amount} vs last month`;
}

function Summary({ totals, previous }: { totals: ReportTotals; previous: ReportTotals | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 print:grid-cols-5">
      <Stat
        label="Uptime"
        value={formatUptime(totals.uptime)}
        tone={totals.uptime === null ? undefined : totals.uptime >= 1 ? "up" : undefined}
        hint={delta(totals.uptime, previous?.uptime ?? null, "pp")}
      />
      <Stat
        label="Incidents"
        value={String(totals.incidents)}
        tone={totals.incidents ? "down" : undefined}
        hint={delta(totals.incidents, previous?.incidents ?? null, "count")}
      />
      <Stat label="Downtime" value={totals.downtimeMs ? duration(totals.downtimeMs) : "None"} />
      <Stat label="Mean time to recover" value={totals.meanRecoveryMs ? duration(totals.meanRecoveryMs) : "—"} />
      {/* Fifth of five: on the two-column phone grid it takes the whole last row. */}
      <div className="col-span-2 grid lg:col-span-1 print:col-span-1">
        <Stat label="Response time (p50)" value={ms(totals.p50Ms)} hint={`${totals.checks.toLocaleString("en")} checks`} />
      </div>
    </div>
  );
}

const dayClass = (ratio: number | null) =>
  ratio === null ? "fill-unknown/40" : ratio >= 1 ? "fill-up/80" : ratio >= 0.99 ? "fill-suspect" : "fill-down";

/** One segment per day: green for a clean day, amber for up to ~15 min of downtime (99%), red beyond that. */
function DayBar({ days }: { days: ReportDay[] }) {
  return (
    <svg
      viewBox={`0 0 ${days.length * 8} 16`}
      className="h-4 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Uptime per day"
    >
      {days.map((d, i) => (
        <rect key={i} x={i * 8} y={0} width={6} height={16} rx={1.5} className={dayClass(d.ratio)}>
          <title>{`${DAY_LABEL.format(d.day)}: ${d.ratio === null ? "not monitored" : formatUptime(d.ratio)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** The monthly report, shared by the in-app preview and the public link. Server-rendered. */
export function ReportView({
  report,
  generatedAt,
  showHosts = true,
}: {
  report: MonthlyReport;
  generatedAt: Date;
  /** Off on public links: a host can be an internal address the owner never meant to publish. */
  showHosts?: boolean;
}) {
  const { month, sites, totals, previous, incidents, latency } = report;
  const partial = report.to < month.to;

  return (
    <article className="space-y-6">
      <header>
        <p className="text-muted text-xs font-medium tracking-wide uppercase">Uptime report</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          {clientLabel(report.client)} · {month.label}
        </h2>
        <p className="text-muted mt-1 text-sm">
          {partial ? `Month to date, until ${dateTime(report.to)}` : "Full month"} · generated {dateTime(generatedAt)} · all
          times UTC
        </p>
      </header>

      {sites.length === 0 ? (
        <Card title="Sites">
          <EmptyState title="No sites in this group" />
        </Card>
      ) : (
        <>
          <Summary totals={totals} previous={previous} />

          <Card title="Sites">
            <div className="-mx-5 -my-5 hidden overflow-x-auto md:block print:block">
              <table className="w-full min-w-[640px] text-sm whitespace-nowrap">
                <thead className="text-muted text-left text-xs">
                  <tr className="border-border border-b">
                    <th className="px-5 py-2.5 font-medium">Site</th>
                    <th className="px-3 py-2.5 font-medium">Uptime</th>
                    <th className="px-3 py-2.5 font-medium">Incidents</th>
                    <th className="px-3 py-2.5 font-medium">Downtime</th>
                    <th className="px-3 py-2.5 font-medium">p50</th>
                    <th className="px-3 py-2.5 font-medium">p95</th>
                    <th className="px-5 py-2.5 text-right font-medium">Checks</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => (
                    <tr key={site.id} className="border-border border-b last:border-0">
                      <td className="px-5 py-3">
                        <p className="font-medium">{site.name}</p>
                        {showHosts && <p className="text-muted font-mono text-xs">{site.host}</p>}
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums">{formatUptime(site.uptime)}</td>
                      <td className="px-3 py-3 tabular-nums">{site.incidents}</td>
                      <td className="px-3 py-3">{site.downtimeMs ? duration(site.downtimeMs) : "—"}</td>
                      <td className="px-3 py-3 font-mono tabular-nums">{ms(site.p50Ms)}</td>
                      <td className="px-3 py-3 font-mono tabular-nums">{ms(site.p95Ms)}</td>
                      <td className="text-muted px-5 py-3 text-right tabular-nums">
                        {site.checks.toLocaleString("en")}
                        {site.failedChecks > 0 && <span className="text-down"> · {site.failedChecks} failed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-border -mx-4 -my-4 divide-y sm:-mx-5 sm:-my-5 md:hidden print:hidden">
              {sites.map((site) => (
                <li key={site.id} className="px-4 py-3.5 text-sm sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{site.name}</p>
                      {showHosts && <p className="text-muted truncate font-mono text-xs">{site.host}</p>}
                    </div>
                    <span className="shrink-0 font-mono font-medium tabular-nums">{formatUptime(site.uptime)}</span>
                  </div>
                  <div className="text-muted mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>
                      {site.incidents} {site.incidents === 1 ? "incident" : "incidents"}
                    </span>
                    {site.downtimeMs > 0 && <span>{duration(site.downtimeMs)} down</span>}
                    <span className="font-mono tabular-nums">
                      p50 {ms(site.p50Ms)} · p95 {ms(site.p95Ms)}
                    </span>
                    <span className="tabular-nums">
                      {site.checks.toLocaleString("en")} checks
                      {site.failedChecks > 0 && <span className="text-down"> · {site.failedChecks} failed</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Day by day">
            <div className="space-y-4">
              {sites.map((site) => (
                <div key={site.id} className="break-inside-avoid">
                  <div className="mb-1.5 flex justify-between gap-3 text-sm">
                    <span className="font-medium">{site.name}</span>
                    <span className="text-muted font-mono text-xs tabular-nums">{formatUptime(site.uptime)}</span>
                  </div>
                  <DayBar days={site.days} />
                </div>
              ))}
              <div className="text-muted flex justify-between text-xs">
                <span>{DAY_LABEL.format(month.from)}</span>
                <span>{DAY_LABEL.format(new Date(report.to.getTime() - 1))}</span>
              </div>
            </div>
          </Card>

          <Card title="Response time by phase">
            {latency.length > 1 ? (
              <>
                <LatencyChart data={latency} span="multiday" />
                <p className="text-muted mt-3 text-xs">
                  Daily median of successful checks across all sites, approximated from hourly data.
                </p>
              </>
            ) : (
              <EmptyState title="Not enough data yet">Hourly medians are computed a few minutes after each hour ends.</EmptyState>
            )}
          </Card>

          <Card title="Incidents">
            {incidents.length === 0 ? (
              <EmptyState title="No incidents this month" />
            ) : (
              <ul className="divide-border -my-2 divide-y">
                {incidents.map((incident) => (
                  <li key={incident.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 break-inside-avoid">
                    <div className="min-w-0">
                      <p className="font-medium">{diagnose(incident.causeCode as ErrorCode, incident.httpStatus).title}</p>
                      <p className="text-muted text-sm">
                        {incident.siteName} · {dateTime(incident.startedAt)}
                        {incident.closedManually && " · closed when monitoring changed"}
                      </p>
                    </div>
                    <span className={`text-sm tabular-nums ${incident.resolvedAt ? "text-muted" : "text-down font-medium"}`}>
                      {incident.resolvedAt
                        ? duration(incident.resolvedAt.getTime() - incident.startedAt.getTime())
                        : `ongoing, ${duration(generatedAt.getTime() - incident.startedAt.getTime())}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <footer className="text-muted border-border border-t pt-4 text-xs leading-relaxed">
        Uptime is time-weighted: the share of monitored time not covered by a confirmed incident (two failed checks in a
        row). Hours without checks, such as while a site was paused, are left out rather than counted as up. Incidents
        count in the month they started. p50 and p95 are the typical hourly values of successful checks, weighted by
        traffic. Generated by SitePulse.
      </footer>
    </article>
  );
}
