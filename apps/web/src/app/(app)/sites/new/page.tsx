import type { Metadata } from "next";
import { SITE_DEFAULTS } from "@/lib/site-options";
import { countSites } from "@/server/dal/sites";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";
import { createSiteAction } from "../actions";
import { SiteForm } from "../site-form";

export const metadata: Metadata = { title: "Add site · SitePulse" };

export default async function NewSitePage() {
  const user = await requireUser();
  const { MAX_SITES_PER_USER, MIN_INTERVAL_SEC } = env();
  const used = await countSites(user.id);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Add site</h1>
      <p className="text-muted mt-1 mb-8 text-sm">
        The first check runs within a minute of saving. {used}/{MAX_SITES_PER_USER} sites used.
      </p>
      <SiteForm
        action={createSiteAction}
        initial={SITE_DEFAULTS}
        minIntervalSec={MIN_INTERVAL_SEC}
        submitLabel="Add site"
        cancelHref="/sites"
      />
    </div>
  );
}
