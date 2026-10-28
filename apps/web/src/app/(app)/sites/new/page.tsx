import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SITE_DEFAULTS } from "@/lib/site-options";
import { listChannels } from "@/server/dal/alerts";
import { countSites } from "@/server/dal/sites";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";
import { createSiteAction } from "../actions";
import { SiteForm } from "../site-form";

export const metadata: Metadata = { title: "Add site · SitePulse" };

export default async function NewSitePage() {
  const user = await requireUser();
  const { MAX_SITES_PER_USER, MIN_INTERVAL_SEC, DEMO_MODE } = env();
  if (DEMO_MODE) redirect("/sites");
  const [used, channels] = await Promise.all([countSites(user.id), listChannels(user.id)]);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Add site</h1>
      <p className="text-muted mt-1 mb-8 text-sm">
        The first check runs within a minute of saving. {used}/{MAX_SITES_PER_USER} sites used.
      </p>
      <SiteForm
        action={createSiteAction}
        // New sites alert every existing channel unless unticked.
        initial={{ ...SITE_DEFAULTS, channelIds: channels.map((c) => c.id) }}
        channels={channels}
        minIntervalSec={MIN_INTERVAL_SEC}
        submitLabel="Add site"
        cancelHref="/sites"
      />
    </div>
  );
}
