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
