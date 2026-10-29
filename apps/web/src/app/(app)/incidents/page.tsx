import { diagnose, type ErrorCode } from "@sitepulse/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState } from "@/components/card";
import { IncidentStatus } from "@/components/incident-status";
import { LiveRefresh } from "@/components/live-refresh";
import { Stat } from "@/components/stat";
import { Button, Select } from "@/components/ui";
import { dateTime, duration } from "@/lib/format";
import {
  decodeCursor,
  incidentStats,
  listIncidents,
  type IncidentStatus as StatusFilter,
} from "@/server/dal/incidents";
import { liveFingerprint } from "@/server/dal/live";
import { listSites } from "@/server/dal/sites";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Incidents · SitePulse" };

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Ongoing" },
  { value: "resolved", label: "Ended" },
];

export default async function IncidentsPage({ searchParams }: PageProps<"/incidents">) {
  const user = await requireUser();
  const live = await liveFingerprint(user.id);
  const params = await searchParams;
  const status: StatusFilter = FILTERS.some((f) => f.value === params.status) ? (params.status as StatusFilter) : "all";
  const before = decodeCursor(typeof params.before === "string" ? params.before : undefined);

  const href = (next: { status?: StatusFilter; site?: string; before?: string }) => {
    const query = new URLSearchParams();
    const s = next.status ?? status;
    if (s !== "all") query.set("status", s);
    if (next.site) query.set("site", next.site);
    if (next.before) query.set("before", next.before);
    const qs = query.toString();
    return qs ? `/incidents?${qs}` : "/incidents";
  };

  // A filter for a site that no longer exists (or is someone else's) would
  // read as "no incidents at all": drop it instead.
  const sites = await listSites(user.id);
  const site = typeof params.site === "string" ? sites.find((s) => s.id === params.site) : undefined;
  if (typeof params.site === "string" && !site) redirect(href({}));

  const now = new Date();
  const [{ rows, next }, stats] = await Promise.all([
    listIncidents(user.id, { status, siteId: site?.id, before }),
    incidentStats(user.id, now),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
          <LiveRefresh since={live} />
        </div>
        <p className="text-muted mt-1 text-sm">
          Confirmed outages: two failed checks in a row. Each one keeps its timeline, its cause and the alerts it sent.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ongoing" value={String(stats.open)} tone={stats.open ? "down" : undefined} />
        <Stat label="Incidents" value={String(stats.total)} hint="last 30 days" />
        <Stat label="Downtime" value={stats.downtimeMs ? duration(stats.downtimeMs) : "None"} hint="last 30 days, all sites" />
        <Stat
          label="Mean time to recover"
          value={stats.meanRecoveryMs ? duration(stats.meanRecoveryMs) : "—"}
          hint="last 30 days"
        />
      </div>

      <Card
        title={site ? `Incidents · ${site.name}` : "All incidents"}
        action={
          <nav aria-label="Status" className="flex gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={href({ status: f.value, site: site?.id })}
                aria-current={f.value === status ? "page" : undefined}
                className={`rounded-md px-2 py-1 text-xs ${f.value === status ? "bg-surface-muted font-medium" : "text-muted hover:text-foreground"}`}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        }
      >
        {sites.length > 1 && (
          <form action="/incidents" className="-mt-1 mb-4 flex flex-wrap items-center gap-2">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            <label htmlFor="site" className="text-muted text-sm">
              Site
            </label>
            <div className="w-56">
              <Select id="site" name="site" defaultValue={site?.id ?? ""}>
                <option value="">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        )}

        {rows.length === 0 ? (
          <EmptyState title={status === "open" ? "Nothing is down right now" : "No incidents recorded"}>
            {status === "all" && "When a site fails two checks in a row, the incident shows up here."}
          </EmptyState>
        ) : (
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm whitespace-nowrap">
              <thead className="text-muted text-left text-xs">
                <tr className="border-border border-y">
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Site</th>
                  <th className="px-3 py-2.5 font-medium">Cause</th>
                  <th className="px-3 py-2.5 font-medium">Started</th>
                  <th className="px-3 py-2.5 font-medium">Duration</th>
                  <th className="px-5 py-2.5 text-right font-medium">Failed checks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ incident, site: s, closedManually, openingStatus }) => (
                  <tr key={incident.id} className="border-border hover:bg-surface-muted/50 border-b last:border-0">
                    <td className="px-5 py-3">
                      <IncidentStatus resolvedAt={incident.resolvedAt} closedManually={closedManually} />
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/incidents/${incident.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="max-w-xs truncate px-3 py-3">
                      {diagnose(incident.causeCode as ErrorCode, openingStatus).title}
                      <span className="text-muted ml-2 font-mono text-xs">{incident.causeCode}</span>
                    </td>
                    <td className="text-muted px-3 py-3">{dateTime(incident.startedAt)}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {duration((incident.resolvedAt ?? now).getTime() - incident.startedAt.getTime())}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums">{incident.failedChecks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(before || next) && (
              <nav aria-label="Pages" className="border-border flex justify-between gap-3 border-t px-5 py-3 text-sm">
                {before ? (
                  <Link href={href({ site: site?.id })} className="text-muted hover:text-foreground">
                    ← Newest
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link href={href({ site: site?.id, before: next })} className="text-muted hover:text-foreground">
                    Older incidents →
                  </Link>
                )}
              </nav>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
