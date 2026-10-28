/**
 * Adds the demo sites (with 7 days of history) to an existing account, for
 * local development:
 *
 *   pnpm --filter @sitepulse/flaky dev          # the flaky service on :8080
 *   pnpm db:seed you@example.com [http://127.0.0.1:8080]
 *
 * The worker needs ALLOW_PRIVATE_CIDRS=127.0.0.0/8 to keep checking them live.
 */
import { createDb, eq, user } from "@sitepulse/db";
import { seedDemoSites } from "./demo";

const [email, targetUrl = "http://127.0.0.1:8080"] = process.argv.slice(2);
if (!email) {
  console.error("Usage: pnpm db:seed <email of an existing user> [flaky service URL]");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL ?? "postgres://sitepulse:sitepulse@localhost:5442/sitepulse", { max: 2 });
const [owner] = await db.select().from(user).where(eq(user.email, email));
if (!owner) {
  console.error(`No user with email ${email}. Create it on /setup first.`);
  process.exit(1);
}
const created = await seedDemoSites(db, { ownerId: owner.id, targetUrl });
console.log(created.length ? `Seeded: ${created.join(", ")}` : "Demo sites already exist for this account.");
await db.$client.end();
