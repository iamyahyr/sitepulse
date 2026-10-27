import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listChannels, siteChannelIds } from "@/server/dal/alerts";
import { getSite } from "@/server/dal/sites";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";
import { updateSiteAction } from "../../actions";
import { DeleteSiteButton } from "../../delete-site-button";
import { SiteForm } from "../../site-form";

export const metadata: Metadata = { title: "Edit site · SitePulse" };

export default async function EditSitePage({ params }: PageProps<"/sites/[id]/edit">) {
  const { id } = await params;
  const user = await requireUser();
  const site = await getSite(user.id, id);
  if (!site) notFound();
  const [channels, linked] = await Promise.all([listChannels(user.id), siteChannelIds(site.id)]);

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {site.name}</h1>
        <p className="text-muted mt-1 mb-8 text-sm">
          Changing the URL or pausing monitoring closes any open incident and restarts the history of failures.
        </p>
        <SiteForm
          action={updateSiteAction.bind(null, site.id)}
          initial={{
            name: site.name,
            url: site.url,
            client: site.client ?? "",
            intervalSec: String(site.intervalSec),
            timeoutMs: String(site.timeoutMs),
            expectedStatus: site.expectedStatus,
            enabled: site.enabled ? "on" : "",
            channelIds: linked,
          }}
          channels={channels}
          minIntervalSec={Math.min(env().MIN_INTERVAL_SEC, site.intervalSec)}
          submitLabel="Save changes"
          cancelHref={`/sites/${site.id}`}
        />
      </div>

      <section className="border-down/30 max-w-xl rounded-xl border p-5">
        <h2 className="text-sm font-semibold">Danger zone</h2>
        <p className="text-muted mt-1 mb-4 text-sm">Deletes the site with all its checks, incidents and alerts.</p>
        <DeleteSiteButton id={site.id} name={site.name} />
      </section>
    </div>
  );
}
