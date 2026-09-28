/**
 * Read-only inspection of a single telegram id across every table that can
 * mention it. Run before a purge so the operator can see exactly what is about to
 * go, and again afterwards to prove it did.
 *
 *   npx tsx scripts/inspect-user.ts 6719294008
 */
import { or, eq } from "drizzle-orm";
import { db } from "../src/core/db.js";
import { accessRequests, admins, referrals, testimonies, transactions, users, whitelist } from "../src/db/schema.js";

const id = process.argv[2];
if (!id || !/^\d+$/.test(id)) {
  console.error("Usage: npx tsx scripts/inspect-user.ts <telegram-id>");
  process.exit(1);
}

const report = {
  user: await db.select().from(users).where(eq(users.telegramId, id)),
  whitelist: await db.select().from(whitelist).where(eq(whitelist.telegramId, id)),
  admins: await db.select().from(admins).where(eq(admins.telegramId, id)),
  accessRequests: await db.select().from(accessRequests).where(eq(accessRequests.telegramId, id)),
  transactions: await db.select().from(transactions).where(eq(transactions.telegramId, id)),
  referrals: await db
    .select()
    .from(referrals)
    .where(or(eq(referrals.referrerId, id), eq(referrals.inviteeId, id))),
  testimonies: await db.select().from(testimonies).where(eq(testimonies.submittedBy, id)),
};

for (const [table, rows] of Object.entries(report)) {
  console.log(`${table.padEnd(15)} ${rows.length}`);
  for (const row of rows) console.log(`    ${JSON.stringify(row)}`);
}

await db.$client.end();
process.exit(0);
