import "server-only";
import { isValidCidr } from "@sitepulse/core";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

/** Comma-separated CIDRs; a typo fails at startup instead of on the first private address. */
const cidrs = (fallback: readonly string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? [...fallback] : v.split(",").map((s) => s.trim()).filter(Boolean)))
    .refine((list) => list.every(isValidCidr), "Use comma-separated CIDRs such as 192.168.1.0/24");

/**
 * Hops allowed to forward the client IP. The client is the rightmost
 * X-Forwarded-For entry outside these ranges, so a value a visitor makes up
 * on the left is ignored. Private ranges cover a reverse proxy on the same
 * host or Docker network (Traefik, Caddy, nginx).
 */
const DEFAULT_TRUSTED_PROXIES = ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"];

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  APP_URL: z.url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /** Encrypts alert channel configs at rest. Must match the worker's value. */
  SITEPULSE_SECRET_KEY: z.string().min(32, "SITEPULSE_SECRET_KEY must be at least 32 characters"),

  /** Read-only public demo: every mutation is refused on the server. */
  DEMO_MODE: bool,
  MAX_SITES_PER_USER: z.coerce.number().int().positive().default(50),
  MIN_INTERVAL_SEC: z.coerce.number().int().min(30).default(60),
  /** CIDRs the prober may reach despite being private, e.g. "192.168.1.0/24". */
  ALLOW_PRIVATE_CIDRS: cidrs(),
  /** Reverse proxies whose X-Forwarded-For is believed, for per-client login rate limits. */
  TRUSTED_PROXIES: cidrs(DEFAULT_TRUSTED_PROXIES),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment, parsed lazily so `next build` works without runtime secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${issues.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}
