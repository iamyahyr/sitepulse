import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Card, EmptyState } from "@/components/card";
import { StatusDot } from "@/components/status-badge";
import { relativeTime } from "@/lib/format";
import { WORKER_STALE_MS } from "@/lib/worker";
import { instanceStatus } from "@/server/dal/instance";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";
import { PasswordForm, ProfileForm } from "./account-forms";

export const metadata: Metadata = { title: "Settings · SitePulse" };

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function Setting({ name, value, hint }: { name: string; value: ReactNode; hint?: string }) {
  return (
    <div className="border-border grid gap-1 border-b py-3 last:border-0 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-muted text-sm">{name}</dt>
      <dd className="min-w-0 text-sm">
        {value}
        {hint && <p className="text-muted mt-0.5 text-xs">{hint}</p>}
      </dd>
    </div>
  );
}

const mono = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

export default async function SettingsPage() {
  const user = await requireUser();
  const e = env();
  const now = new Date();
  const { workers, databaseBytes } = e.DEMO_MODE ? { workers: [], databaseBytes: 0 } : await instanceStatus(now);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted mt-1 text-sm">Your account and how this SitePulse instance is running.</p>
      </div>

      {e.DEMO_MODE && (
        <p className="border-border bg-surface text-muted rounded-lg border px-4 py-3 text-sm">
          Account settings are disabled and instance details hidden in the read-only demo.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <ProfileForm name={user.name} email={user.email} disabled={e.DEMO_MODE} />
        </Card>
        <Card title="Password">
          <PasswordForm disabled={e.DEMO_MODE} />
        </Card>
      </div>

      {/* Container names and network settings are nobody else's business on a public demo. */}
      {!e.DEMO_MODE && (
        <>
          <Card title="Workers" action={<span className="text-muted text-xs">Reported in the last 24 h</span>}>
            {workers.length === 0 ? (
              <EmptyState title="No worker has reported yet">
                Sites are only checked while the worker runs. With Docker it starts with the stack; in development, run{" "}
                {mono("pnpm dev")}.
              </EmptyState>
            ) : (
              <div className="-mx-5 -my-5 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm whitespace-nowrap">
                  <thead className="text-muted text-left text-xs">
                    <tr className="border-border border-b">
                      <th className="px-5 py-2.5 font-medium">Worker</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Version</th>
                      <th className="px-3 py-2.5 font-medium">Last heartbeat</th>
                      <th className="px-5 py-2.5 text-right font-medium">Checks run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workers.map((w) => {
                      const stale = now.getTime() - w.lastSeenAt.getTime() > WORKER_STALE_MS;
                      return (
                        <tr key={w.workerId} className="border-border border-b last:border-0">
                          <td className="px-5 py-3 font-mono text-xs">{w.workerId}</td>
                          <td className="px-3 py-3">
                            {stale ? (
                              <span className="text-down inline-flex items-center gap-2">
                                <StatusDot state="down" />
                                Not responding
                              </span>
                            ) : w.offlineSince ? (
                              <span className="text-suspect inline-flex items-center gap-2" title={`Since ${w.offlineSince.toISOString()}`}>
                                <StatusDot state="suspect" />
                                {w.offlineReason === "dns" ? "No DNS" : "No internet"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <StatusDot state="up" />
                                Running
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs">{w.version}</td>
                          <td className="text-muted px-3 py-3">{relativeTime(w.lastSeenAt, now)}</td>
                          <td className="px-5 py-3 text-right font-mono tabular-nums">{w.checksRun.toLocaleString("en")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Instance">
            <dl className="-my-3">
              <Setting name="Public URL" value={mono(e.APP_URL)} hint="APP_URL: used for sign-in cookies and links in alerts." />
              <Setting
                name="Sites per user"
                value={e.MAX_SITES_PER_USER}
                hint="MAX_SITES_PER_USER"
              />
              <Setting name="Shortest check interval" value={`${e.MIN_INTERVAL_SEC} s`} hint="MIN_INTERVAL_SEC" />
              <Setting
                name="Private networks allowed"
                value={e.ALLOW_PRIVATE_CIDRS.length ? mono(e.ALLOW_PRIVATE_CIDRS.join(", ")) : "None"}
                hint="ALLOW_PRIVATE_CIDRS: private ranges this instance may monitor and send webhooks to. Set the same value on the worker."
              />
              <Setting
                name="Trusted proxies"
                value={mono(e.TRUSTED_PROXIES.join(", "))}
                hint="TRUSTED_PROXIES: hops whose X-Forwarded-For is believed for login rate limits."
              />
              <Setting name="Database size" value={bytes(databaseBytes)} hint="Raw checks are pruned by the worker after CHECK_RETENTION_DAYS (30 by default)." />
              <Setting name="Mode" value={e.DEMO_MODE ? "Read-only public demo" : "Self-hosted"} />
            </dl>
          </Card>
        </>
      )}
    </div>
  );
}
