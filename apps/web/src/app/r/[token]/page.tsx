import { Activity } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PrintButton } from "@/components/print-button";
import { clientLabel, ReportView } from "@/components/report-view";
import { getSharedReport } from "@/server/dal/reports";

/** One lookup per request, shared by the metadata and the page. */
const loadReport = cache(getSharedReport);

/** The link is the only credential: keep it out of search engines and Referer headers. */
export async function generateMetadata({ params }: PageProps<"/r/[token]">): Promise<Metadata> {
  const report = await loadReport((await params).token);
  return {
    title: report ? `${clientLabel(report.client)} · ${report.month.label} · Uptime report` : "Report not found",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/** Public, read-only monthly report behind a share link. No session, no app navigation. */
export default async function SharedReportPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const report = await loadReport(token);
  if (!report) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <Activity className="text-up size-5" aria-hidden />
          SitePulse
        </span>
        <PrintButton />
      </div>
      <ReportView report={report} generatedAt={new Date()} showHosts={false} />
    </div>
  );
}
