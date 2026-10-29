import "server-only";
import { desc, gt, sql, workerHeartbeats } from "@sitepulse/db";
import { db } from "@/server/db";

const DAY = 86_400_000;

/**
 * What the instance itself is doing: the workers that reported in the last
 * day (older rows belong to replaced containers) and the database's size.
 */
export async function instanceStatus(now: Date) {
  const [workers, size] = await Promise.all([
    db()
      .select()
      .from(workerHeartbeats)
      .where(gt(workerHeartbeats.lastSeenAt, new Date(now.getTime() - DAY)))
      .orderBy(desc(workerHeartbeats.lastSeenAt)),
    db().execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`),
  ]);
  return { workers, databaseBytes: Number(size[0]?.bytes ?? 0) };
}
