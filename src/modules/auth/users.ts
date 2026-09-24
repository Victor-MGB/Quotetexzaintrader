import { eq } from "drizzle-orm";
import { db } from "../../core/db.js";
import { users } from "../../db/schema.js";

export async function findUserByTelegramId(telegramId: string) {
  const rows = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
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