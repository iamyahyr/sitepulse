import "server-only";
import { createDb, type Database } from "@sitepulse/db";
import { env } from "@/server/env";

// Reuse the pool across hot reloads in development, and create it lazily so
// importing this module never requires env vars at build time.
const globalForDb = globalThis as unknown as { db?: Database };

export function db(): Database {
  globalForDb.db ??= createDb(env().DATABASE_URL);
  return globalForDb.db;
}
