import { desc, eq } from "drizzle-orm";
import { db } from "../../core/db.js";
import { users } from "../../db/schema.js";

export type UserRow = typeof users.$inferSelect;

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

export async function deleteUser(telegramId: string): Promise<boolean> {
  const rows = await db.delete(users).where(eq(users.telegramId, telegramId)).returning({ id: users.id });
  return rows.length > 0;
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