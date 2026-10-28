import { diagnose, formatUptime, type ErrorCode } from "@sitepulse/core";
import { Info, Plus, ShieldAlert, WifiOff } from "lucide-react";
import Link from "next/link";
import { Card, EmptyState } from "@/components/card";
import { DegradationNotice } from "@/components/degradation-notice";
import { PhaseWaterfall } from "@/components/phase-waterfall";
import { StatusBadge, StatusDot } from "@/components/status-badge";
import { buttonClass } from "@/components/ui";
import { UptimeBar } from "@/components/uptime-bar";
import { brokenPhase, checkPhases } from "@/lib/checks";
import { clockTime, duration, ms, relativeTime } from "@/lib/format";
import { getDashboard, type OpenIncident } from "@/server/dal/dashboard";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";

const UPTIME_METHOD =
  "Time-weighted: the share of the last 7 days not covered by a confirmed incident. Not the ratio of successful checks.";

/** The worker is considered stalled after this long without a heartbeat. */
const WORKER_STALE_MS = 3 * 60_000;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="border-border bg-surface rounded-xl border px-5 py-4">
      <p className="text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "down" ? "text-down" : tone === "up" ? "text-up" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function OpenIncidentCard({ open: { site, incident, lastFailed }, now }: { open: OpenIncident; now: Date }) {
  const code = (lastFailed?.errorCode ?? incident.causeCode) as ErrorCode;
  const diagnosis = diagnose(code, lastFailed?.httpStatus);

  return (
    <Card
      title={`Open incident · ${site.name}`}
      action={
        <span className="text-down text-xs font-medium">
          {duration(now.getTime() - incident.startedAt.getTime())} and counting
        </span>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-muted font-mono text-xs uppercase">
            {diagnosis.layer} layer · {lastFailed?.httpStatus ? `HTTP ${lastFailed.httpStatus}` : code}
          </p>
          <h3 className="mt-1 text-lg font-semibold">{diagnosis.title}</h3>
          <p className="text-muted mt-2 text-sm leading-relaxed">{diagnosis.hint}</p>
          <Link href={`/sites/${site.id}`} className="mt-4 inline-block text-sm underline underline-offset-4">
            View site
          </Link>
        </div>
        {lastFailed && (
          <div>
            <p className="text-muted mb-3 text-xs">Anatomy of the last failed check</p>
            <PhaseWaterfall phases={checkPhases(lastFailed)} failedAt={brokenPhase(lastFailed.errorCode)} />
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Shown while the worker reports that its own server is offline. Network-level
 * failures are not held against sites meanwhile, so this banner is the only
 * place the outage shows up: it must be impossible to miss.
 */
function MonitorOfflineBanner({ since, reason, now }: { since: Date; reason: "network" | "dns" | null; now: Date }) {
  return (
    <div role="alert" className="border-suspect/50 bg-suspect/10 flex gap-3 rounded-xl border px-5 py-4">
      <WifiOff className="text-suspect mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="text-sm leading-relaxed">
        <p className="font-semibold">
          SitePulse&apos;s own server {reason === "dns" ? "cannot resolve domain names" : "cannot reach the internet"} since{" "}
          {clockTime(since)}
          {now.getTime() - since.getTime() >= 60_000 && ` (${duration(now.getTime() - since.getTime())})`}
        </p>
        <p className="text-muted mt-1">
          Network-level failures are not counted against your sites meanwhile, so nothing is marked down because of
          this. Sites that still answer keep being checked normally. Monitoring resumes on its own once connectivity is back.
        </p>
      </div>
    </div>
  );
}

function WorkerStatus({ lastSeen, now }: { lastSeen: Date | null; now: Date }) {
  if (!lastSeen) {
    return (
      <p className="text-suspect flex items-center gap-2 text-sm">
        <StatusDot state="suspect" />
        Worker has not run yet
      </p>
    );
  }
  const stale = now.getTime() - lastSeen.getTime() > WORKER_STALE_MS;
  return (
    <p className={`flex items-center gap-2 text-sm ${stale ? "text-down" : "text-muted"}`}>
      <StatusDot state={stale ? "down" : "up"} />
      Worker last ran {relativeTime(lastSeen, now)}
    </p>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { now, sites, openIncidents, worker } = await getDashboard(user.id);
  const workerFresh = worker !== null && now.getTime() - worker.lastSeenAt.getTime() <= WORKER_STALE_MS;

  const enabled = sites.filter((s) => s.enabled);
  const operational = enabled.filter((s) => s.state === "up").length;
  const slowest = [...enabled].sort((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0))[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted mt-1 text-sm">Checks run on the server whether or not this page is open.</p>
        </div>
        <WorkerStatus lastSeen={worker?.lastSeenAt ?? null} now={now} />
      </div>

      {workerFresh && worker.offlineSince && (
        <MonitorOfflineBanner since={worker.offlineSince} reason={worker.offlineReason} now={now} />
      )}

      {sites.length === 0 ? (
        <Card title="Get started">
          <EmptyState title="No sites yet">
            <p className="mb-4">Add a site and SitePulse starts checking it right away.</p>
            {!env().DEMO_MODE && (
              <Link href="/sites/new" className={buttonClass()}>
                <Plus className="size-4" aria-hidden />
                Add site
              </Link>
            )}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Sites" value={String(sites.length)} />
            <Stat label="Operational" value={`${operational}/${enabled.length}`} tone="up" />
            <Stat
              label="Open incidents"
              value={String(openIncidents.length)}
              tone={openIncidents.length ? "down" : undefined}
            />
            <Stat label="Slowest (p50, 24 h)" value={slowest?.p50Ms ? ms(slowest.p50Ms) : "—"} />
          </div>

          {openIncidents.map((open) => (
            <OpenIncidentCard key={open.incident.id} open={open} now={now} />
          ))}

          {sites.map(
            (site) =>
              site.degradation && (
                <DegradationNotice key={site.degradation.id} degradation={site.degradation} now={now} site={site} />
              ),
          )}

          <Card title="Sites">
            <div className="-mx-5 -my-5 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm whitespace-nowrap">
                <thead className="text-muted text-left text-xs">
                  <tr className="border-border border-b">
                    <th className="px-5 py-2.5 font-medium">Site</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="w-48 px-3 py-2.5 font-medium">Last 48 h</th>
                    <th className="px-3 py-2.5 font-medium">
                      <span className="inline-flex items-center gap-1" title={UPTIME_METHOD}>
                        Uptime 7 d <Info className="size-3" aria-label={UPTIME_METHOD} />
                      </span>
                    </th>
                    <th className="px-3 py-2.5 font-medium">p50</th>
                    <th className="px-3 py-2.5 font-medium">TLS</th>
                    <th className="px-5 py-2.5 text-right font-medium">Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => {
                    const tlsDays = site.tlsExpiresAt
                      ? Math.floor((site.tlsExpiresAt.getTime() - now.getTime()) / 86_400_000)
                      : null;
                    return (
                      <tr key={site.id} className="border-border border-b last:border-0">
                        <td className="px-5 py-3">
                          <Link href={`/sites/${site.id}`} className="font-medium hover:underline">
                            {site.name}
                          </Link>
                          <p className="text-muted max-w-xs truncate font-mono text-xs">
                            {site.url.replace(/^https?:\/\//, "")}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          {site.enabled ? <StatusBadge state={site.state} /> : <span className="text-muted">Paused</span>}
                          {site.degradation && (
                            <span
                              className="border-suspect/50 text-suspect ml-2 rounded border px-1.5 py-0.5 text-[11px] font-medium"
                              title="Slower than its usual median"
                            >
                              Slow
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <UptimeBar buckets={site.buckets} />
                        </td>
                        <td className="px-3 py-3 font-mono tabular-nums">{formatUptime(site.uptime7d)}</td>
                        <td className="px-3 py-3 font-mono tabular-nums">{ms(site.p50Ms)}</td>
                        <td className="px-3 py-3">
                          {tlsDays === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 font-mono text-xs ${tlsDays < 14 ? "text-suspect" : "text-muted"}`}
                            >
                              {tlsDays < 14 && <ShieldAlert className="size-3.5" aria-hidden />}
                              {tlsDays} d
                            </span>
                          )}
                        </td>
                        <td className="text-muted px-5 py-3 text-right text-xs">
                          {site.lastCheckedAt ? relativeTime(site.lastCheckedAt, now) : "Not yet"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
