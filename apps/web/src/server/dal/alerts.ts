import "server-only";
import {
  checkUrl,
  decryptJson,
  encryptJson,
  generateWebhookSecret,
  isDiscordWebhookUrl,
  sendAlert,
  type ChannelConfig,
  type PostResult,
} from "@sitepulse/core";
import {
  alertChannels,
  and,
  count,
  desc,
  eq,
  incidents,
  inArray,
  notifications,
  siteAlertChannels,
  siteDegradations,
  sites,
  sql,
} from "@sitepulse/db";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";

/**
 * Alert channels. The decrypted config (webhook URLs embed their own
 * credentials) never leaves this module except as a masked hint.
 */

export const MAX_CHANNELS_PER_USER = 20;

export type ChannelSummary = {
  id: string;
  type: "discord" | "webhook";
  name: string;
  /** Host and path prefix only, safe to show. */
  hint: string;
  siteCount: number;
  createdAt: Date;
};

const isUuid = (id: string) => z.uuid().safeParse(id).success;

function mask(config: ChannelConfig): string {
  try {
    const url = new URL(config.url);
    const path = config.type === "discord" ? url.pathname.split("/").slice(0, 4).join("/") : url.pathname;
    return `${url.host}${path.length > 32 ? `${path.slice(0, 32)}…` : path}${config.type === "discord" ? "/…" : ""}`;
  } catch {
    return "—";
  }
}

export async function listChannels(ownerId: string): Promise<ChannelSummary[]> {
  const rows = await db()
    .select({ channel: alertChannels, siteCount: count(siteAlertChannels.siteId) })
    .from(alertChannels)
    .leftJoin(siteAlertChannels, eq(siteAlertChannels.channelId, alertChannels.id))
    .where(eq(alertChannels.ownerId, ownerId))
    .groupBy(alertChannels.id)
    .orderBy(alertChannels.name);

  const key = env().SITEPULSE_SECRET_KEY;
  return rows.map(({ channel, siteCount }) => {
    let hint = "Cannot decrypt (secret key changed?)";
    try {
      hint = mask(decryptJson<ChannelConfig>(key, channel.configEncrypted));
    } catch {}
    return { id: channel.id, type: channel.type, name: channel.name, hint, siteCount, createdAt: channel.createdAt };
  });
}

export type NewChannel = { type: "discord" | "webhook"; name: string; url: string };

export class ChannelInputError extends Error {}

/** Creates a channel. For webhooks, returns the signing secret: it is shown to the user exactly once. */
export async function createChannel(ownerId: string, input: NewChannel): Promise<{ id: string; secret: string | null }> {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name || name.length > 80) throw new ChannelInputError("Give the channel a name (up to 80 characters).");

  let config: ChannelConfig;
  if (input.type === "discord") {
    if (!isDiscordWebhookUrl(url)) {
      throw new ChannelInputError("Paste a Discord webhook URL: https://discord.com/api/webhooks/…");
    }
    config = { type: "discord", url };
  } else {
    const check = checkUrl(url, { allowPrivateCidrs: env().ALLOW_PRIVATE_CIDRS });
    if (!check.ok) throw new ChannelInputError("Use a public http(s) URL. Internal addresses need ALLOW_PRIVATE_CIDRS.");
    config = { type: "webhook", url: check.url.href, secret: generateWebhookSecret() };
  }

  const [existing] = await db().select({ n: count() }).from(alertChannels).where(eq(alertChannels.ownerId, ownerId));
  if ((existing?.n ?? 0) >= MAX_CHANNELS_PER_USER) {
    throw new ChannelInputError(`Up to ${MAX_CHANNELS_PER_USER} alert channels per user.`);
  }

  const [channel] = await db()
    .insert(alertChannels)
    .values({ ownerId, type: config.type, name, configEncrypted: encryptJson(env().SITEPULSE_SECRET_KEY, config) })
    .returning({ id: alertChannels.id });
  return { id: channel!.id, secret: config.type === "webhook" ? config.secret : null };
}

export async function deleteChannel(ownerId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db()
    .delete(alertChannels)
    .where(and(eq(alertChannels.id, id), eq(alertChannels.ownerId, ownerId)))
    .returning({ id: alertChannels.id });
  return deleted.length > 0;
}

/** Sends a test message right away, bypassing the outbox. */
export async function sendTestAlert(ownerId: string, id: string): Promise<PostResult> {
  if (!isUuid(id)) return { ok: false, status: null, retryable: false, error: "Channel not found." };
  const [channel] = await db()
    .select()
    .from(alertChannels)
    .where(and(eq(alertChannels.id, id), eq(alertChannels.ownerId, ownerId)));
  if (!channel) return { ok: false, status: null, retryable: false, error: "Channel not found." };

  const { SITEPULSE_SECRET_KEY, ALLOW_PRIVATE_CIDRS, APP_URL } = env();
  let config: ChannelConfig;
  try {
    config = decryptJson<ChannelConfig>(SITEPULSE_SECRET_KEY, channel.configEncrypted);
  } catch {
    return { ok: false, status: null, retryable: false, error: "Cannot decrypt this channel. Was SITEPULSE_SECRET_KEY changed?" };
  }
  return sendAlert(
    config,
    {
      kind: "test",
      deliveryId: `test-${crypto.randomUUID()}`,
      site: { id: "test", name: channel.name, url: APP_URL },
      incident: null,
      dashboardUrl: new URL("/alerts", APP_URL).href,
    },
    { guard: { allowPrivateCidrs: ALLOW_PRIVATE_CIDRS } },
  );
}

/** Channel ids linked to a site, for the site form. */
export async function siteChannelIds(siteId: string): Promise<string[]> {
  const rows = await db()
    .select({ id: siteAlertChannels.channelId })
    .from(siteAlertChannels)
    .where(eq(siteAlertChannels.siteId, siteId));
  return rows.map((r) => r.id);
}

/** Only channels owned by `ownerId` survive, so a forged id cannot link someone else's channel. */
export async function ownedChannelIds(ownerId: string, ids: string[]): Promise<string[]> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return [];
  const rows = await db()
    .select({ id: alertChannels.id })
    .from(alertChannels)
    .where(and(eq(alertChannels.ownerId, ownerId), inArray(alertChannels.id, valid)));
  return rows.map((r) => r.id);
}

export async function recentDeliveries(ownerId: string, limit = 20) {
  return db()
    .select({
      id: notifications.id,
      kind: notifications.kind,
      status: notifications.status,
      attempts: notifications.attempts,
      lastError: notifications.lastError,
      createdAt: notifications.createdAt,
      sentAt: notifications.sentAt,
      nextAttemptAt: notifications.nextAttemptAt,
      channelName: alertChannels.name,
      siteId: sites.id,
      siteName: sites.name,
    })
    .from(notifications)
    .innerJoin(alertChannels, eq(alertChannels.id, notifications.channelId))
    // An alert is about an incident or a degradation; either one leads to the site.
    .leftJoin(incidents, eq(incidents.id, notifications.incidentId))
    .leftJoin(siteDegradations, eq(siteDegradations.id, notifications.degradationId))
    .innerJoin(sites, sql`${sites.id} = coalesce(${incidents.siteId}, ${siteDegradations.siteId})`)
    .where(eq(alertChannels.ownerId, ownerId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
