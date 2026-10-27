import { hostname } from "node:os";
import { DEFAULT_DNS_CANARIES, DEFAULT_TCP_CANARIES } from "@sitepulse/core";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === "true" || v === "1"));

const list = (fallback: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? [...fallback] : v.split(",").map((s) => s.trim()).filter(Boolean)));

const schema = z.object({
  DATABASE_URL: z.url(),
  /** Probes running at the same time in this process. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(10),
  /** How often to look for due sites. */
  WORKER_POLL_MS: z.coerce.number().int().min(250).default(2_000),
  WORKER_ID: z.string().min(1).default(`${hostname()}-${process.pid}`),
  /** Dead-man's switch (e.g. healthchecks.io): pinged every minute while the worker is healthy. */
  HEARTBEAT_URL: z.url().optional(),
  ALLOW_PRIVATE_CIDRS: z
    .string()
    .optional()
    .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
  RUN_MIGRATIONS: bool(true),
  /** Same value as the web app: decrypts alert channel configs. */
  SITEPULSE_SECRET_KEY: z.string().min(32, "SITEPULSE_SECRET_KEY must be at least 32 characters"),
  /** Public URL of the web app, used for links in alerts. */
  APP_URL: z.url().optional(),
  /**
   * Canaries for the self-connectivity guard. Unset = sensible public
   * defaults; set to an empty string to disable a kind of canary.
   */
  CONNECTIVITY_TCP_TARGETS: list(DEFAULT_TCP_CANARIES),
  CONNECTIVITY_DNS_NAMES: list(DEFAULT_DNS_CANARIES),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
