import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * First-run setup link. Until the admin account exists, whoever reaches the
 * instance first could claim it, so /setup and sign-up also require a token
 * that only someone with access to the server's logs can read.
 *
 * It is derived from BETTER_AUTH_SECRET, so every process agrees on it with
 * nothing stored, and it stops mattering once the admin exists (sign-up closes).
 */
export function setupToken(): string {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update("sitepulse:setup").digest("base64url").slice(0, 32);
}

export function isSetupToken(given: string | null | undefined): boolean {
  if (!given) return false;
  const expected = Buffer.from(setupToken());
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let lastAnnouncedAt = 0;

/** Prints the setup link to the server log, at most once a minute. Call it only while no account exists. */
export function announceSetupLink() {
  const now = Date.now();
  if (now - lastAnnouncedAt < 60_000) return;
  lastAnnouncedAt = now;
  const url = new URL("/setup", env().APP_URL);
  url.searchParams.set("token", setupToken());
  console.info(`[sitepulse] No admin account yet. Create it at: ${url.href}`);
}
