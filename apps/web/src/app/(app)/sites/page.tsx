import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState } from "@/components/card";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui";
import { intervalLabel } from "@/lib/checks";
import { ms, relativeTime } from "@/lib/format";
import { latestChecks, listSites } from "@/server/dal/sites";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Sites · SitePulse" };

export default async function SitesPage() {
  const user = await requireUser();
  const sites = await listSites(user.id);
  const latest = await latestChecks(sites.map((s) => s.id));
  const now = new Date();
  const { MAX_SITES_PER_USER, DEMO_MODE } = env();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
          <p className="text-muted mt-1 text-sm">
            {sites.length}/{MAX_SITES_PER_USER} sites monitored
          </p>
        </div>
        {!DEMO_MODE && sites.length < MAX_SITES_PER_USER && (
          <Link href="/sites/new" className={buttonClass()}>
            <Plus className="size-4" aria-hidden />
            Add site
          </Link>
        )}
      </div>

      <Card title="All sites">
        {sites.length === 0 ? (
          <EmptyState title="No sites yet">
            <Link href="/sites/new" className="underline underline-offset-4">
              Add your first site
            </Link>{" "}
            and SitePulse starts checking it right away.
          </EmptyState>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm whitespace-nowrap">
              <thead className="text-muted text-left text-xs">
                <tr className="border-border border-b">
                  <th className="px-5 py-2.5 font-medium">Site</th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Every</th>
                  <th className="px-3 py-2.5 font-medium">Last response</th>
                  <th className="px-5 py-2.5 text-right font-medium">Checked</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const check = latest.get(site.id);
                  return (
                    <tr key={site.id} className="border-border hover:bg-surface-muted/50 border-b last:border-0">
                      <td className="px-5 py-3">
                        <Link href={`/sites/${site.id}`} className="font-medium hover:underline">
                          {site.name}
                        </Link>
                        <p className="text-muted max-w-xs truncate font-mono text-xs">{site.url.replace(/^https?:\/\//, "")}</p>
                      </td>
                      <td className="text-muted px-3 py-3">{site.client ?? "—"}</td>
                      <td className="px-3 py-3">
                        {site.enabled ? <StatusBadge state={site.state} /> : <span className="text-muted text-sm">Paused</span>}
                      </td>
                      <td className="text-muted px-3 py-3">{intervalLabel(site.intervalSec)}</td>
                      <td className="px-3 py-3 font-mono tabular-nums">
                        {check ? (check.success ? ms(check.totalMs) : (check.errorCode ?? "error")) : "—"}
                      </td>
                      <td className="text-muted px-5 py-3 text-right text-xs">
                        {site.lastCheckedAt ? relativeTime(site.lastCheckedAt, now) : "Not checked yet"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
