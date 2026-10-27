"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SiteFormState } from "@/lib/site-options";
import { QuotaExceededError, createSite, deleteSite, updateSite } from "@/server/dal/sites";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";
import { parseSiteInput, readSiteForm } from "@/server/site-input";

const DEMO_ERROR = "This is a read-only demo. Self-host SitePulse to add your own sites.";

export async function createSiteAction(_prev: SiteFormState, formData: FormData): Promise<SiteFormState> {
  const user = await requireUser();
  const values = readSiteForm(formData);
  if (env().DEMO_MODE) return { values, formError: DEMO_ERROR };

  const parsed = parseSiteInput(values);
  if (!parsed.ok) return { values, fieldErrors: parsed.fieldErrors };

  let id: string;
  try {
    id = (await createSite(user.id, parsed.data)).id;
  } catch (err) {
    if (err instanceof QuotaExceededError) return { values, formError: err.message };
    throw err;
  }
  revalidatePath("/", "layout");
  redirect(`/sites/${id}`);
}

export async function updateSiteAction(id: string, _prev: SiteFormState, formData: FormData): Promise<SiteFormState> {
  const user = await requireUser();
  const values = readSiteForm(formData);
  if (env().DEMO_MODE) return { values, formError: DEMO_ERROR };

  const parsed = parseSiteInput(values);
  if (!parsed.ok) return { values, fieldErrors: parsed.fieldErrors };

  const site = await updateSite(user.id, id, parsed.data);
  if (!site) return { values, formError: "This site no longer exists." };
  revalidatePath("/", "layout");
  redirect(`/sites/${id}`);
}

export async function deleteSiteAction(id: string): Promise<void> {
  const user = await requireUser();
  if (env().DEMO_MODE) return;
  await deleteSite(user.id, id);
  revalidatePath("/", "layout");
  redirect("/sites");
}
