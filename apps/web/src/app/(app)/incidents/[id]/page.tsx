import { diagnose, type ErrorCode } from "@sitepulse/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/card";
import { IncidentStatus } from "@/components/incident-status";
import { LiveRefresh } from "@/components/live-refresh";
import { PhaseWaterfall } from "@/components/phase-waterfall";
import { brokenPhase, checkPhases } from "@/lib/checks";
import { dateTime, duration, ms, relativeTime } from "@/lib/format";
import { getIncident } from "@/server/dal/incidents";
import { liveFingerprint } from "@/server/dal/live";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Incident · SitePulse" };

type Tone = "down" | "up" | "alert" | "muted";
type Moment = { at: Date; tone: Tone; title: string; detail?: string };

const DOT: Record<Tone, string> = {
  down: "bg-down",
  up: "bg-up",
  alert: "bg-suspect",
  muted: "bg-unknown",
};

const title = (code: string | null, status?: number | null) => diagnose((code ?? "UNKNOWN") as ErrorCode, status).title;

export default async function IncidentPage({ params }: PageProps<"/incidents/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const live = await liveFingerprint(user.id, { incident: id });
  const data = await getIncident(user.id, id);
  if (!data) notFound();

  const { incident, site, closedManually, events, firstFailed, confirming, lastFailed, breakdown, recoveryCheck, alerts } =
    data;
  const now = new Date();
  const end = incident.resolvedAt ?? now;
  const cause = diagnose(incident.causeCode as ErrorCode, firstFailed?.httpStatus);
  const latestChanged = lastFailed && lastFailed.errorCode !== incident.causeCode;
  const totalFailed = breakdown.reduce((sum, b) => sum + b.checks, 0);

  // The incident starts exactly at its first failed check. If that check is
  // gone, retention pruned the beginning, and the oldest checks left must not
  // be passed off as the first and the confirming one.
  const complete = firstFailed !== null && firstFailed.checkedAt.getTime() === incident.startedAt.getTime();
  const failureDetail = (check: NonNullable<typeof firstFailed>) =>
    `${title(check.errorCode, check.httpStatus)}${check.errorMessage ? ` · ${check.errorMessage}` : ""}`;

  // One chronological story: what the checks saw, what the state machine decided, what was sent.
  const moments: Moment[] = [];
  const opened = events.find((e) => e.type === "opened");
  if (complete) {
    moments.push({ at: firstFailed.checkedAt, tone: "down", title: "First failed check", detail: failureDetail(firstFailed) });
    moments.push({
      at: confirming?.checkedAt ?? opened?.at ?? incident.startedAt,
      tone: "down",
      title: "Confirmed by a second failure: incident opened",
      detail: "Downtime counts from the first failed check.",
    });
  } else {
    moments.push({
      at: incident.startedAt,
      tone: "down",
      title: "Incident started",
      detail: "Its first checks are past the retention period.",
    });
    if (firstFailed) {
      moments.push({ at: firstFailed.checkedAt, tone: "down", title: "Earliest failed check still stored", detail: failureDetail(firstFailed) });
    }
  }
  let previous = opened?.errorCode ?? incident.causeCode;
  for (const event of events) {
    if (event.type === "cause_changed") {
      moments.push({
        at: event.at,
        tone: "alert",
        title: "Cause changed",
        detail: `${title(previous)} → ${title(event.errorCode)}`,
      });
      previous = event.errorCode ?? previous;
    } else if (event.type === "resolved") {
      moments.push({
        at: event.at,
        tone: "up",
        title: "Recovered",
        detail: recoveryCheck
          ? `First successful check: HTTP ${recoveryCheck.httpStatus} in ${ms(recoveryCheck.totalMs)}.`
          : undefined,
      });
    } else if (event.type === "closed") {
      moments.push({
        at: event.at,
        tone: "muted",
        title: "Closed without a recovery",
        detail: "Monitoring was paused or the URL changed, so this is not counted as a recovery.",
      });
    }
  }
  for (const alert of alerts) {
    const what = alert.kind === "up" ? "Recovery alert" : "Down alert";
    if (alert.status === "sent" && alert.sentAt) {
      moments.push({ at: alert.sentAt, tone: "muted", title: `${what} delivered to ${alert.channelName}` });
    } else if (alert.status === "failed") {
      moments.push({
        at: alert.createdAt,
        tone: "alert",
        title: `${what} to ${alert.channelName} failed`,
        detail: `${alert.attempts} attempt(s)${alert.lastError ? ` · ${alert.lastError}` : ""}`,
      });
    } else {
      moments.push({
        at: alert.createdAt,
        tone: "muted",
        title: `${what} to ${alert.channelName} queued`,
        detail: alert.attempts > 0 ? `Retrying after ${alert.attempts} attempt(s)${alert.lastError ? ` · ${alert.lastError}` : ""}` : undefined,
      });
    }
  }
  // Ended: how it broke. Ongoing: how it is breaking now.
  const shown = incident.resolvedAt ? firstFailed : (lastFailed ?? firstFailed);
  if (!incident.resolvedAt && lastFailed && lastFailed.id !== firstFailed?.id && lastFailed.id !== confirming?.id) {
    moments.push({
      at: lastFailed.checkedAt,
      tone: "down",
      title: "Still failing",
      detail: `Latest check: ${title(lastFailed.errorCode, lastFailed.httpStatus)}`,
    });
  }
  moments.sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/incidents" className="text-muted hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" aria-hidden />
          Incidents
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{cause.title}</h1>
          <IncidentStatus resolvedAt={incident.resolvedAt} closedManually={closedManually} />
          <LiveRefresh since={live} scope={{ incident: id }} />
        </div>
        <p className="text-muted mt-1 text-sm">
          <Link href={`/sites/${site.id}`} className="text-foreground font-medium hover:underline">
            {site.name}
          </Link>
          {" · "}started {dateTime(incident.startedAt)} · {incident.resolvedAt ? "lasted" : "down for"}{" "}
          <span className="text-foreground font-medium">{duration(end.getTime() - incident.startedAt.getTime())}</span> ·{" "}
          {incident.failedChecks} failed checks
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Diagnosis">
          <p className="text-muted font-mono text-xs uppercase">
            {cause.layer} layer · {firstFailed?.httpStatus ? `HTTP ${firstFailed.httpStatus}` : incident.causeCode}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{cause.title}</h2>
          <p className="text-muted mt-2 text-sm leading-relaxed">{cause.hint}</p>
          {latestChanged && (
            <p className="border-border mt-4 border-t pt-4 text-sm">
              <span className="text-muted">{incident.resolvedAt ? "Last cause before recovery: " : "Failing now with: "}</span>
              <span className="font-medium">{title(lastFailed.errorCode, lastFailed.httpStatus)}</span>
            </p>
          )}
          {(lastFailed?.errorMessage ?? incident.lastErrorMessage) && (
            <p className="text-muted mt-3 font-mono text-xs break-all">{lastFailed?.errorMessage ?? incident.lastErrorMessage}</p>
          )}
        </Card>

        <Card title={incident.resolvedAt ? "Where the request broke" : "Where the request is breaking"}>
          {shown ? (
            <WaterfallOf check={shown} />
          ) : (
            <p className="text-muted text-sm">The failed checks of this incident are past the retention period.</p>
          )}
          {recoveryCheck && (
            <div className="border-border mt-5 border-t pt-5">
              <p className="text-muted mb-3 text-xs">After the recovery, {relativeTime(recoveryCheck.checkedAt, now)}</p>
              <WaterfallOf check={recoveryCheck} />
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Timeline">
          <ol className="relative">
            {moments.map((m, i) => (
              <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
                {i < moments.length - 1 && <span className="bg-border absolute top-3 bottom-0 left-[4.5px] w-px" aria-hidden />}
                <span className={`${DOT[m.tone]} relative mt-1.5 size-2.5 shrink-0 rounded-full`} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{m.title}</span>
                    <span className="text-muted block font-mono text-xs sm:ml-2 sm:inline">{dateTime(m.at)}</span>
                  </p>
                  {m.detail && <p className="text-muted mt-0.5 text-sm break-words">{m.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Failed checks by cause">
          {breakdown.length === 0 ? (
            <p className="text-muted text-sm">No failed checks left in the retention window.</p>
          ) : (
            <ul className="space-y-3">
              {breakdown.map((b) => (
                <li key={`${b.errorCode}-${b.httpStatus}`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{title(b.errorCode, b.httpStatus)}</span>
                    <span className="font-mono text-xs tabular-nums">{b.checks}</span>
                  </div>
                  <div className="bg-surface-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
                    <div className="bg-down h-full rounded-full" style={{ width: `${(b.checks / totalFailed) * 100}%` }} />
                  </div>
                  <p className="text-muted mt-1 font-mono text-[11px]">
                    {b.errorCode}
                    {b.httpStatus ? ` · HTTP ${b.httpStatus}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function WaterfallOf({ check }: { check: Parameters<typeof checkPhases>[0] }) {
  return (
    <>
      <p className="text-muted mb-3 text-xs">
        {dateTime(check.checkedAt)} · {check.success ? `HTTP ${check.httpStatus}` : (check.errorCode ?? "failed")} · {ms(check.totalMs)}
      </p>
      <PhaseWaterfall
        phases={checkPhases(check)}
        failedAt={check.success ? undefined : brokenPhase(check.errorCode)}
        totalMs={check.totalMs}
      />
    </>
  );
}
