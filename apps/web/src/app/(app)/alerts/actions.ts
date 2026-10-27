"use server";

import { revalidatePath } from "next/cache";
import { ChannelInputError, createChannel, deleteChannel, sendTestAlert } from "@/server/dal/alerts";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";

const DEMO_ERROR = "This is a read-only demo. Self-host SitePulse to connect your own alerts.";

export type ChannelFormState = {
  values: { type: string; name: string; url: string };
  error?: string;
  /** Set once after creating a channel; the webhook secret is never shown again. */
  created?: { name: string; secret: string | null };
};

export async function createChannelAction(_prev: ChannelFormState, formData: FormData): Promise<ChannelFormState> {
  const user = await requireUser();
  const values = {
    type: String(formData.get("type") ?? ""),
    name: String(formData.get("name") ?? ""),
    url: String(formData.get("url") ?? ""),
  };
  if (env().DEMO_MODE) return { values, error: DEMO_ERROR };
  if (values.type !== "discord" && values.type !== "webhook") return { values, error: "Pick a channel type." };

  try {
    const { secret } = await createChannel(user.id, { type: values.type, name: values.name, url: values.url });
    revalidatePath("/alerts");
    return { values: { type: values.type, name: "", url: "" }, created: { name: values.name.trim(), secret } };
  } catch (err) {
    if (err instanceof ChannelInputError) return { values, error: err.message };
    throw err;
  }
}

export async function deleteChannelAction(id: string): Promise<void> {
  const user = await requireUser();
  if (env().DEMO_MODE) return;
  await deleteChannel(user.id, id);
  revalidatePath("/alerts");
}

// One test message per user every few seconds: the button must not become a way
// to make this server spam an arbitrary endpoint.
const lastTestAt = new Map<string, number>();
const TEST_COOLDOWN_MS = 5_000;

export async function testChannelAction(id: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  if (env().DEMO_MODE) return { ok: false, message: DEMO_ERROR };

  const now = Date.now();
  if (now - (lastTestAt.get(user.id) ?? 0) < TEST_COOLDOWN_MS) {
    return { ok: false, message: "Wait a few seconds between test messages." };
  }
  lastTestAt.set(user.id, now);

  const result = await sendTestAlert(user.id, id);
  return result.ok
    ? { ok: true, message: `Delivered (HTTP ${result.status}).` }
    : { ok: false, message: `Not delivered: ${result.error}` };
}
