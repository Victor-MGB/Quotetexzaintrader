import { eq } from "drizzle-orm";
import { adminIds } from "../../core/config.js";
import { db } from "../../core/db.js";
import { admins, settings, whitelist } from "../../db/schema.js";

const allowed = new Set<string>();
const promoted = new Set<string>();
let locked = false;
let loaded = false;

export function isAdmin(telegramId: string): boolean {
  return adminIds.includes(telegramId) || promoted.has(telegramId);
}

/** True only for the permanent ADMIN_IDS entries, which cannot be demoted. */
export function isPermanentAdmin(telegramId: string): boolean {
  return adminIds.includes(telegramId);
}

export async function loadAccess(): Promise<void> {
  const [rows, lockRows, adminRows] = await Promise.all([
    db.select({ telegramId: whitelist.telegramId }).from(whitelist),
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "locked")),
    db.select({ telegramId: admins.telegramId }).from(admins),
  ]);

  allowed.clear();
  for (const row of rows) allowed.add(row.telegramId);
  promoted.clear();
  for (const row of adminRows) promoted.add(row.telegramId);
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

export interface AdminEntry {
  telegramId: string;
  permanent: boolean;
}

export async function promoteAdmin(telegramId: string, byId: string): Promise<boolean> {
  const rows = await db
    .insert(admins)
    .values({ telegramId, addedBy: byId })
    .onConflictDoNothing()
    .returning({ telegramId: admins.telegramId });
  if (!rows.length) return false;
  promoted.add(telegramId);
  return true;
}

export async function demoteAdmin(telegramId: string): Promise<boolean> {
  const rows = await db
    .delete(admins)
    .where(eq(admins.telegramId, telegramId))
    .returning({ telegramId: admins.telegramId });
  promoted.delete(telegramId);
  return rows.length > 0;
}

export async function listAdmins(): Promise<AdminEntry[]> {
  const entries: AdminEntry[] = adminIds.map((telegramId) => ({ telegramId, permanent: true }));
  for (const id of promoted) {
    if (!adminIds.includes(id)) entries.push({ telegramId: id, permanent: false });
  }
  return entries;
}