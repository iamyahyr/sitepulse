import { sql } from "@sitepulse/db";
import { db } from "@/server/db";

/** Liveness for Docker/Dokploy: the app is up and can reach Postgres. No data is exposed. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
