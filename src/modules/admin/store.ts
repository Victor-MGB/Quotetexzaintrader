import { eq } from "drizzle-orm";
import { adminIds } from "../../core/config.js";
import { db } from "../../core/db.js";
import { settings, whitelist } from "../../db/schema.js";

const allowed = new Set<string>();
let locked = false;
let loaded = false;

export function isAdmin(telegramId: string): boolean {
  return adminIds.includes(telegramId);
}

export async function loadAccess(): Promise<void> {
  const [rows, lockRows] = await Promise.all([
    db.select({ telegramId: whitelist.telegramId }).from(whitelist),
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "locked")),
  ]);

  allowed.clear();
  for (const row of rows) allowed.add(row.telegramId);
  locked = lockRows[0]?.value === "true";
  loaded = true;
}

export function isLocked(): boolean {
  return locked;
}

export function isAllowed(telegramId: string): boolean {
  if (isAdmin(telegramId)) return true;
  if (!loaded || locked || !allowed.has(telegramId)) return false;
  return true;
}

export async function allowUser(telegramId: string): Promise<void> {
  await db.insert(whitelist).values({ telegramId }).onConflictDoNothing();
  allowed.add(telegramId);
}

export async function disallowUser(telegramId: string): Promise<void> {
  await db.delete(whitelist).where(eq(whitelist.telegramId, telegramId));
  allowed.delete(telegramId);
}

export async function listAllowed(): Promise<string[]> {
  return [...allowed];
}

export async function setLock(lock: boolean): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "locked", value: lock ? "true" : "false" })
    .onConflictDoUpdate({ target: settings.key, set: { value: lock ? "true" : "false" } });
  locked = lock;
}