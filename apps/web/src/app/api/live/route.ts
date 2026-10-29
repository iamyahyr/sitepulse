import { liveFingerprint, type LiveScope } from "@/server/dal/live";
import { getSessionUser } from "@/server/session";

/** Change fingerprint polled by <LiveRefresh />: open pages refresh only when it moves. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });

  const params = new URL(request.url).searchParams;
  const site = params.get("site");
  const incident = params.get("incident");
  const scope: LiveScope | undefined = site ? { site } : incident ? { incident } : undefined;
  return Response.json({ v: await liveFingerprint(user.id, scope) }, { headers: { "cache-control": "no-store" } });
}
