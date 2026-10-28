import "server-only";
import { count, schema } from "@sitepulse/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { SETUP_TOKEN_HEADER } from "@/lib/setup";
import { isSetupToken } from "@/server/setup-token";

export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db().select({ n: count() }).from(schema.user);
  return (row?.n ?? 0) > 0;
}

function createAuth() {
  const e = env();

  return betterAuth({
    appName: "SitePulse",
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    databaseHooks: {
      user: {
        create: {
          // Self-hosted, single-tenant: sign-up is only open until the first
          // account (the admin, created on /setup) exists, and only to whoever
          // holds the setup link from the server logs.
          async before(_user, ctx) {
            if (e.DEMO_MODE || (await hasAnyUser())) {
              throw new APIError("FORBIDDEN", { message: "Sign-up is closed on this instance." });
            }
            if (!isSetupToken(ctx?.headers?.get(SETUP_TOKEN_HEADER))) {
              throw new APIError("FORBIDDEN", { message: "Open the setup link printed in the server logs." });
            }
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: e.NODE_ENV === "production",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    advanced: {
      ipAddress: { trustedProxies: e.TRUSTED_PROXIES },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { auth?: Auth };

/** Lazily created so the module can be imported at build time without secrets. */
export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}
