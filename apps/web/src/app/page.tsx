import { diagnose, formatUptime, type ErrorCode } from "@sitepulse/core";
import { Info, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { LatencyChart, type LatencyPoint } from "@/components/latency-chart";
import { PhaseWaterfall } from "@/components/phase-waterfall";
import { StatusBadge, StatusDot } from "@/components/status-badge";
import { UptimeBar } from "@/components/uptime-bar";
import { clockTime, duration, ms, relativeTime } from "@/lib/format";
import { NOW, checkTotal, sites, workerLastSeen, type MockSite, type Phases } from "@/lib/mock";

const UPTIME_METHOD =
  "Time-weighted: the share of the last 7 days not covered by a confirmed incident. Not the ratio of successful checks.";

function brokenPhase(code: ErrorCode): keyof Phases | undefined {
  if (code === "TTFB_TIMEOUT") return "ttfb";
  if (code === "BODY_TIMEOUT") return "download";
  const layer = diagnose(code).layer;
  if (layer === "dns") return "dns";
  if (layer === "tcp") return "connect";
  if (layer === "tls") return "tls";
  return undefined;
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-border bg-surface rounded-xl border">
      <header className="border-border flex items-center justify-between gap-4 border-b px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

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

function OpenIncident({ site }: { site: MockSite }) {
  const incident = site.incidents.find((i) => i.end === null)!;
  const lastFailed = site.checks.findLast((c) => !c.ok)!;
  const diagnosis = diagnose(incident.cause, lastFailed.status);

  return (
    <Card
      title={`Open incident · ${site.name}`}
      action={<span className="text-down text-xs font-medium">{duration(NOW.getTime() - incident.start.getTime())} and counting</span>}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-muted font-mono text-xs uppercase">
            {diagnosis.layer} layer · {lastFailed.status ? `HTTP ${lastFailed.status}` : incident.cause}
          </p>
          <h3 className="mt-1 text-lg font-semibold">{diagnosis.title}</h3>
          <p className="text-muted mt-2 text-sm leading-relaxed">{diagnosis.hint}</p>
          <ol className="border-border mt-5 space-y-3 border-l pl-4">
            {incident.timeline.map((step) => (
              <li key={step.label} className="relative text-sm">
                <span className="bg-down absolute top-1.5 -left-[1.3rem] size-2 rounded-full" />
                <span className="text-muted mr-2 font-mono text-xs">{clockTime(step.at)}</span>
                {step.label}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <p className="text-muted mb-3 text-xs">Anatomy of the last failed check</p>
          <PhaseWaterfall phases={lastFailed.phases} failedAt={brokenPhase(incident.cause)} />
          <p className="text-muted mt-4 text-xs leading-relaxed">
            DNS, TCP and TLS all completed, so the server is reachable; the response itself is the failure.
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const operational = sites.filter((s) => s.state === "up").length;
  const openIncidents = sites.filter((s) => s.state === "down");
  const slowest = [...sites].sort((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0))[0];
  const chartSite = sites.find((s) => s.id === "api")!;
  const dayAgo = NOW.getTime() - 24 * 3_600_000;
  const chartData: LatencyPoint[] = chartSite.checks
    .filter((c) => c.ok && c.at.getTime() >= dayAgo)
    .map((c) => ({ t: c.at.getTime(), ...c.phases }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted mt-1 text-sm">
            <span className="bg-surface-muted border-border mr-2 rounded border px-1.5 py-0.5 font-mono text-[11px]">
              demo data
            </span>
            Checks run on the server every 5 minutes, whether or not this page is open.
          </p>
        </div>
        <p className="text-muted flex items-center gap-2 text-sm">
          <StatusDot state="up" />
          Worker last ran {relativeTime(workerLastSeen, NOW)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sites" value={String(sites.length)} />
        <Stat label="Operational" value={`${operational}/${sites.length}`} tone="up" />
        <Stat label="Open incidents" value={String(openIncidents.length)} tone={openIncidents.length ? "down" : undefined} />
        <Stat label="Slowest (p50, 24 h)" value={slowest ? ms(slowest.p50Ms) : "—"} />
      </div>

      {openIncidents.map((site) => (
        <OpenIncident key={site.id} site={site} />
      ))}

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
                const tlsDays = Math.floor((site.tlsExpiresAt.getTime() - NOW.getTime()) / 86_400_000);
                const last = site.checks.at(-1)!;
                return (
                  <tr key={site.id} className="border-border border-b last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium">{site.name}</p>
                      <p className="text-muted font-mono text-xs">{site.url.replace(/^https?:\/\//, "")}</p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge state={site.state} />
                    </td>
                    <td className="px-3 py-3">
                      <UptimeBar checks={site.checks} />
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums">{formatUptime(site.uptime7d)}</td>
                    <td className="px-3 py-3 font-mono tabular-nums">{ms(last.ok ? checkTotal(last) : site.p50Ms)}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 font-mono text-xs ${tlsDays < 14 ? "text-suspect" : "text-muted"}`}
                      >
                        {tlsDays < 14 && <ShieldAlert className="size-3.5" aria-hidden />}
                        {tlsDays} d
                      </span>
                    </td>
                    <td className="text-muted px-5 py-3 text-right text-xs">{relativeTime(site.lastCheckedAt, NOW)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`${chartSite.name} · response time by phase, last 24 h`}>
        <LatencyChart data={chartData} />
        <p className="text-muted mt-3 text-xs">
          Stacked by phase so a slowdown points at its layer. For this API most of the time is server processing (TTFB), not the network.
        </p>
      </Card>
    </div>
  );
}
