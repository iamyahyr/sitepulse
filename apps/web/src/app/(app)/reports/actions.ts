"use server";

import { revalidatePath } from "next/cache";
import { parseMonth } from "@/lib/months";
import { createShare, listClients, revokeShare } from "@/server/dal/reports";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";

const DEMO_ERROR = "This is a read-only demo. Self-host SitePulse to share reports.";

export type ShareResult = { url?: string; error?: string };

export async function createShareAction(client: string | null, monthKey: string): Promise<ShareResult> {
  const user = await requireUser();
  if (env().DEMO_MODE) return { error: DEMO_ERROR };
  // Server actions are public endpoints: arguments arrive as whatever the caller sent.
  if ((typeof client !== "string" && client !== null) || typeof monthKey !== "string") return { error: "Invalid request." };

  const month = parseMonth(monthKey);
  if (!month) return { error: "Pick a month." };
  // Only groups that exist: a link must never point at an arbitrary, empty "client".
  if (!(await listClients(user.id)).includes(client)) return { error: "Pick a client." };

  const token = await createShare(user.id, client, month);
  revalidatePath("/reports");
  return { url: new URL(`/r/${token}`, env().APP_URL).toString() };
}

export async function revokeShareAction(id: string): Promise<void> {
  const user = await requireUser();
  if (env().DEMO_MODE || typeof id !== "string") return;
  await revokeShare(user.id, id);
  revalidatePath("/reports");
}
