import { ConnectivityMonitor } from "@sitepulse/core";
import { createDb } from "@sitepulse/db";
import { migrateDatabase } from "@sitepulse/db/migrate";
import { loadEnv } from "./env";
import { log } from "./log";
import { Worker } from "./worker";

async function main() {
  const env = loadEnv();

  if (env.RUN_MIGRATIONS) {
    await migrateDatabase(env.DATABASE_URL);
    log("info", "migrations applied");
  }

  const db = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 2 });
  const worker = new Worker(db, {
    workerId: env.WORKER_ID,
    concurrency: env.WORKER_CONCURRENCY,
    pollMs: env.WORKER_POLL_MS,
    guard: { allowPrivateCidrs: env.ALLOW_PRIVATE_CIDRS },
    heartbeatUrl: env.HEARTBEAT_URL,
    connectivity:
      env.CONNECTIVITY_TCP_TARGETS.length || env.CONNECTIVITY_DNS_NAMES.length
        ? new ConnectivityMonitor({ tcpTargets: env.CONNECTIVITY_TCP_TARGETS, dnsNames: env.CONNECTIVITY_DNS_NAMES })
        : null,
  });
  worker.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("info", "shutting down", { signal });
    await worker.stop();
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log("error", "worker crashed", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  process.exit(1);
});
