import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { db } from "../../core/db.js";
import { accessRequests, admins, referrals, testimonies, transactions, users, whitelist } from "../../db/schema.js";

export type UserRow = typeof users.$inferSelect;

export async function countUsers(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return Number(rows[0]?.n ?? 0);
}

export async function countUsersSince(since: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(gte(users.createdAt, since));
  return Number(rows[0]?.n ?? 0);
}

export async function findUserByTelegramId(telegramId: string) {
  const rows = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function listUsers(): Promise<UserRow[]> {
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export interface PurgeResult {
  user: UserRow;
  transactions: number;
  /** Both directions: people they referred, and whoever referred them. */
  referrals: number;
  testimonies: number;
}

/**
 * Removes a person from the database entirely.
 *
 * Deleting only the users row left a ghost behind: their transactions, referrals
 * and testimonies kept their telegram id, and the whitelisted "approved" row and
 * the live login session outlived the account. The result was a member who had
 * been deleted still holding a balance in the admin's history and still being
 * let in by the gate. So every table that mentions the id goes in the same
 * transaction — either the account is gone completely or nothing was removed.
 *
 * Media objects uploaded with a testimony are not touched: they live in a private
 * bucket and are shared by nothing but name, so a deleted row leaves an orphaned
 * file rather than a broken card.
 */
export async function deleteUser(telegramId: string): Promise<PurgeResult | null> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(users)
      .where(eq(users.telegramId, telegramId))
      .returning();
    const user = removed[0];
    if (!user) return null;

    // Children first. There are no foreign keys to cascade on, so the order is
    // by convention rather than enforced, and deleting the parent first would
    // leave the same orphans this function exists to remove.
    const txn = await tx
      .delete(transactions)
      .where(eq(transactions.telegramId, telegramId))
      .returning({ id: transactions.id });
    const refs = await tx
      .delete(referrals)
      .where(or(eq(referrals.referrerId, telegramId), eq(referrals.inviteeId, telegramId)))
      .returning({ id: referrals.id });
    const tst = await tx
      .delete(testimonies)
      .where(eq(testimonies.submittedBy, telegramId))
      .returning({ id: testimonies.id });
    await tx.delete(accessRequests).where(eq(accessRequests.telegramId, telegramId));
    await tx.delete(whitelist).where(eq(whitelist.telegramId, telegramId));
    await tx.delete(admins).where(eq(admins.telegramId, telegramId));

    return { user, transactions: txn.length, referrals: refs.length, testimonies: tst.length };
  });
}

export async function createUser({
  telegramId,
  username,
  firstName,
  lastName,
  email,
  passwordHash,
}: {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  passwordHash: string;
}) {
  const rows = await db
    .insert(users)
    .values({ telegramId, username, firstName, lastName, email, passwordHash })
    .onConflictDoNothing({ target: users.telegramId })
    .returning();
  return rows[0] ?? null;
}