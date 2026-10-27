import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "@/server/auth";

export type SessionUser = { id: string; name: string; email: string };

/** Current session, deduplicated per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Read headers before touching auth/env: it marks the route dynamic, so
  // `next build` never tries to prerender it without runtime secrets.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, name, email } = session.user;
  return { id, name, email };
});

/** Use at the top of every protected page, server action and route handler. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
