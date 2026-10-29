import type { Metadata } from "next";
import { Card, EmptyState } from "@/components/card";
import { clientLabel, ReportView } from "@/components/report-view";
import { Button, Select } from "@/components/ui";
import { parseMonth, recentMonths } from "@/lib/months";
import { getMonthlyReport, listClients, listShares } from "@/server/dal/reports";
import { requireUser } from "@/server/session";
import { SharePanel } from "./share-panel";

export const metadata: Metadata = { title: "Reports · SitePulse" };

/** Query value for the sites without a client: an empty `client` is always stored as null, so no real name collides. */
const NO_CLIENT = "";
/** Hourly rollups are kept for 400 days by default: a year back plus the current month. */
const MONTHS = 13;

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requireUser();
  const params = await searchParams;
  const now = new Date();
  const clients = await listClients(user.id);

  if (clients.length === 0) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <Card title="Monthly reports">
          <EmptyState title="No sites yet">Add a site and its monthly report shows up here.</EmptyState>
        </Card>
      </div>
    );
  }

  const months = recentMonths(now, MONTHS);
  const rawClient = typeof params.client === "string" ? params.client : undefined;
  const client = rawClient === NO_CLIENT ? null : rawClient !== undefined && clients.includes(rawClient) ? rawClient : clients[0]!;
  const requested = months.find((m) => m.key === parseMonth(typeof params.month === "string" ? params.month : undefined)?.key);

  // Last month by default, since a finished month is what gets sent to a client,
  // unless monitoring only started this month.
  let month = requested ?? months[1]!;
  let report = await getMonthlyReport(user.id, client, month, now);
  if (!requested && report.totals.uptime === null) {
    month = months[0]!;
    report = await getMonthlyReport(user.id, client, month, now);
  }
  const shares = await listShares(user.id, client, month);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-muted mt-1 text-sm">
            A month of uptime, incidents and response times per client, to share as a link or a PDF.
          </p>
        </div>
        <form action="/reports" className="flex flex-wrap items-center gap-2">
          <div className="w-56">
            <Select name="client" aria-label="Client" defaultValue={client ?? NO_CLIENT}>
              {clients.map((c) => (
                <option key={c ?? NO_CLIENT} value={c ?? NO_CLIENT}>
                  {clientLabel(c)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select name="month" aria-label="Month" defaultValue={month.key}>
              {months.map((m, i) => (
                <option key={m.key} value={m.key}>
                  {i === 0 ? `${m.label} (to date)` : m.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </div>

      {report.sites.length > 0 && <SharePanel client={client} month={month.key} shares={shares} />}

      <ReportView report={report} generatedAt={now} />
    </div>
  );
}
