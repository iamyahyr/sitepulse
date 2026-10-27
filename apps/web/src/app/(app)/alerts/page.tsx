import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState } from "@/components/card";
import { relativeTime } from "@/lib/format";
import { listChannels, recentDeliveries } from "@/server/dal/alerts";
import { requireUser } from "@/server/session";
import { ChannelActions } from "./channel-actions";
import { ChannelForm } from "./channel-form";

export const metadata: Metadata = { title: "Alerts · SitePulse" };

const STATUS_STYLE = {
  sent: "text-up",
  pending: "text-suspect",
  failed: "text-down",
} as const;

export default async function AlertsPage() {
  const user = await requireUser();
  const [channels, deliveries] = await Promise.all([listChannels(user.id), recentDeliveries(user.id)]);
  const now = new Date();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-muted mt-1 text-sm">
          One message when an incident opens and one when it resolves. Never one per failed check.
        </p>
      </div>

      <Card title="Channels">
        {channels.length === 0 ? (
          <EmptyState title="No alert channels yet">Add one below, then pick it on each site.</EmptyState>
        ) : (
          <ul className="-my-2">
            {channels.map((channel) => (
              <li
                key={channel.id}
                className="border-border flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {channel.name}{" "}
                    <span className="text-muted ml-1 text-xs font-normal">
                      {channel.type === "discord" ? "Discord" : "Webhook"} · {channel.siteCount}{" "}
                      {channel.siteCount === 1 ? "site" : "sites"}
                    </span>
                  </p>
                  <p className="text-muted truncate font-mono text-xs">{channel.hint}</p>
                </div>
                <ChannelActions id={channel.id} name={channel.name} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Add a channel">
        <ChannelForm />
      </Card>

      <Card title="Recent deliveries">
        {deliveries.length === 0 ? (
          <EmptyState title="Nothing sent yet">Alerts appear here when an incident opens or resolves.</EmptyState>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm whitespace-nowrap">
              <thead className="text-muted text-left text-xs">
                <tr className="border-border border-b">
                  <th className="px-5 py-2.5 font-medium">Event</th>
                  <th className="px-3 py-2.5 font-medium">Channel</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-border border-b align-top last:border-0">
                    <td className="px-5 py-3">
                      <Link href={`/sites/${d.siteId}`} className="font-medium hover:underline">
                        {d.siteName}
                      </Link>{" "}
                      <span className="text-muted">{d.kind === "down" ? "went down" : d.kind === "up" ? "recovered" : "degraded"}</span>
                    </td>
                    <td className="text-muted px-3 py-3">{d.channelName}</td>
                    <td className="px-3 py-3">
                      <span className={`font-medium ${STATUS_STYLE[d.status]}`}>{d.status}</span>
                      {d.attempts > 1 && <span className="text-muted text-xs"> · {d.attempts} attempts</span>}
                      {d.status === "pending" && d.attempts > 0 && (
                        <span className="text-muted text-xs"> · retrying {relativeTime(d.nextAttemptAt, now).replace(" ago", "")}</span>
                      )}
                      {d.lastError && d.status !== "sent" && (
                        <p className="text-muted max-w-xs truncate font-mono text-xs" title={d.lastError}>
                          {d.lastError}
                        </p>
                      )}
                    </td>
                    <td className="text-muted px-5 py-3 text-right text-xs">{relativeTime(d.sentAt ?? d.createdAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
