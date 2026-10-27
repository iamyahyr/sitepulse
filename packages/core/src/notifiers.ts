import { diagnose, type ErrorCode } from "./diagnosis";
import { safePost, type PostOptions, type PostResult } from "./outbound";
import { signWebhook } from "./secrets";

/** Decrypted channel configuration. Stored encrypted; never sent to the browser. */
export type ChannelConfig = { type: "discord"; url: string } | { type: "webhook"; url: string; secret: string };

export type AlertKind = "down" | "up" | "test";

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
  const title =
    event.kind === "test"
      ? `Test alert for ${event.site.name}`
      : event.kind === "down"
        ? `${event.site.name} is down`
        : `${event.site.name} recovered after ${formatDuration(downtimeMs)}`;
  return { incident, diagnosis, downtimeMs, title };
}

export function discordPayload(event: AlertEvent) {
  const { incident, diagnosis, title } = describe(event);
  const color = event.kind === "down" ? 0xdc2626 : event.kind === "up" ? 0x16a34a : 0x6b7280;
  const icon = event.kind === "down" ? "🔴" : event.kind === "up" ? "🟢" : "🔔";

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
              : "The site is responding normally again.",
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function webhookPayload(event: AlertEvent) {
  const { incident, diagnosis, downtimeMs, title } = describe(event);
  return {
    type: event.kind === "test" ? "test" : event.kind === "down" ? "incident.opened" : "incident.resolved",
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
