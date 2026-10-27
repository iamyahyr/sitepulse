import "server-only";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .optional()
  .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean));

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
  ALLOW_PRIVATE_CIDRS: csv,
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
