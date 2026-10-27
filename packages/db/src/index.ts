import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10 });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

export { schema };
export * from "./schema";

// Re-exported so apps use the exact drizzle-orm instance the schema was built
// with (pnpm can otherwise resolve a second copy through better-auth's peers).
export { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
