import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { DEMO_USER, eq, user } from "@sitepulse/db";
import { getAuth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";

export type SessionUser = { id: string; name: string; email: string };

/** Current session, deduplicated per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Read headers before touching auth/env: it marks the route dynamic, so
  // `next build` never tries to prerender it without runtime secrets.
  const requestHeaders = await headers();

  // Public demo: everyone browses as the demo visitor, with no login and no
  // session. Every mutation is refused separately (see DEMO_MODE checks).
  if (env().DEMO_MODE) {
    const [visitor] = await db().select().from(user).where(eq(user.id, DEMO_USER.id));
    return visitor ? { id: visitor.id, name: visitor.name, email: visitor.email } : null;
  }

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
