import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for signed-out visitors. This only checks that a session
 * cookie exists; real authorization happens in every page, action and route
 * handler through requireUser() and the data access layer.
 */
export function proxy(request: NextRequest) {
  // The public demo has no logins: pages resolve to the demo visitor.
  if (process.env.DEMO_MODE === "true" || process.env.DEMO_MODE === "1") return NextResponse.next();
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|setup|r/|api/auth|api/health|_next|favicon.ico).*)"],
};
