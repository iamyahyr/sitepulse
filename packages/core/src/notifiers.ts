import { PHASE_INFO, type Phase } from "./degradation";
import { diagnose, type ErrorCode } from "./diagnosis";
import { safePost, type PostOptions, type PostResult } from "./outbound";
import { signWebhook } from "./secrets";

/** Decrypted channel configuration. Stored encrypted; never sent to the browser. */
export type ChannelConfig = { type: "discord"; url: string } | { type: "webhook"; url: string; secret: string };

export type AlertKind = "down" | "up" | "degraded" | "test";

export type AlertEvent = {
  kind: AlertKind;
  /** Stable per delivery: receivers can use it to de-duplicate retries. */
  deliveryId: string;
  site: { id: string; name: string; url: string };
  incident: {
    id: string;
    startedAt: Date;
    resolvedAt: Date | null;
    cause: ErrorCode;
    lastErrorMessage: string | null;
    httpStatus: number | null;
  } | null;
  /** Set for "degraded" alerts: which phase slowed down and by how much. */
  degradation?: {
    id: string;
    phase: Phase;
    startedAt: Date;
    baselineMs: number;
    recentMs: number;
  } | null;
  /** Link to the site in the dashboard, when APP_URL is known. */
  dashboardUrl: string | null;
};

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

export function isDiscordWebhookUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && DISCORD_HOSTS.has(url.hostname) && /^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function describe(event: AlertEvent) {
  const incident = event.incident;
  const diagnosis = incident ? diagnose(incident.cause, incident.httpStatus) : null;
  const downtimeMs = incident ? (incident.resolvedAt ?? new Date()).getTime() - incident.startedAt.getTime() : 0;
  const slow = event.degradation ?? null;
  const ratio = slow ? slow.recentMs / Math.max(slow.baselineMs, 1) : 0;
  const title =
    event.kind === "test"
      ? `Test alert for ${event.site.name}`
      : event.kind === "down"
        ? `${event.site.name} is down`
        : event.kind === "degraded" && slow
          ? `${event.site.name} is slowing down: ${PHASE_INFO[slow.phase].label} ×${ratio.toFixed(1)}`
          : `${event.site.name} recovered after ${formatDuration(downtimeMs)}`;
  return { incident, diagnosis, downtimeMs, title, slow, ratio };
}

export function discordPayload(event: AlertEvent) {
  const { incident, diagnosis, title, slow } = describe(event);
  const color = { down: 0xdc2626, up: 0x16a34a, degraded: 0xd97706, test: 0x6b7280 }[event.kind];
  const icon = { down: "🔴", up: "🟢", degraded: "🟡", test: "🔔" }[event.kind];

  const fields = [{ name: "URL", value: event.site.url.slice(0, 1000) }];
  if (incident) {
    fields.push({ name: "Started", value: `<t:${Math.floor(incident.startedAt.getTime() / 1000)}:f>` });
    fields.push({ name: "Cause", value: `\`${incident.cause}\`${incident.httpStatus ? ` (HTTP ${incident.httpStatus})` : ""}` });
  }

  return {
    username: "SitePulse",
    // Site names are user input: never let them ping @everyone or roles.
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: `${icon} ${title}`.slice(0, 256),
        url: event.dashboardUrl ?? undefined,
        color,
        description:
          event.kind === "test"
            ? "If you can read this, alerts for this channel work."
            : event.kind === "down" && diagnosis
              ? `**${diagnosis.title}**\n${diagnosis.hint}`
              : event.kind === "degraded" && slow
                ? `**${PHASE_INFO[slow.phase].label}** takes ${Math.round(slow.recentMs)} ms instead of the usual ${Math.round(slow.baselineMs)} ms. The site is still up.\n${PHASE_INFO[slow.phase].hint}`
                : "The site is responding normally again.",
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

const WEBHOOK_TYPES = { down: "incident.opened", up: "incident.resolved", degraded: "site.degraded", test: "test" } as const;

export function webhookPayload(event: AlertEvent) {
  const { incident, diagnosis, downtimeMs, title, slow, ratio } = describe(event);
  return {
    type: WEBHOOK_TYPES[event.kind],
    deliveryId: event.deliveryId,
    title,
    site: event.site,
    incident: incident && {
      id: incident.id,
      startedAt: incident.startedAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      durationSec: Math.round(downtimeMs / 1000),
      cause: incident.cause,
      httpStatus: incident.httpStatus,
      lastErrorMessage: incident.lastErrorMessage,
    },
    diagnosis,
    degradation: slow && {
      id: slow.id,
      phase: slow.phase,
      startedAt: slow.startedAt.toISOString(),
      baselineMs: Math.round(slow.baselineMs),
      recentMs: Math.round(slow.recentMs),
      ratio: Number(ratio.toFixed(2)),
    },
    dashboardUrl: event.dashboardUrl,
    sentAt: new Date().toISOString(),
  };
}

export async function sendAlert(config: ChannelConfig, event: AlertEvent, options: PostOptions = {}): Promise<PostResult> {
  if (config.type === "discord") {
    if (!isDiscordWebhookUrl(config.url)) {
      return { ok: false, status: null, retryable: false, error: "Not a Discord webhook URL" };
    }
    return safePost(config.url, JSON.stringify(discordPayload(event)), {}, options);
  }

  const payload = webhookPayload(event);
  const body = JSON.stringify(payload);
  return safePost(
    config.url,
    body,
    {
      "x-sitepulse-event": payload.type,
      "x-sitepulse-delivery": event.deliveryId,
      "x-sitepulse-signature": signWebhook(config.secret, body),
    },
    options,
  );
}
