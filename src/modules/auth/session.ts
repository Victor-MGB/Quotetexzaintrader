import { env } from "../../core/config.js";
import { isAdmin } from "../admin/store.js";

const sessionTimeoutMs = env.SESSION_TIMEOUT_MINUTES * 60_000;

const sessions = new Map<string, number>();

export function isLoggedIn(telegramId: string): boolean {
  if (isAdmin(telegramId)) return true;
  const last = sessions.get(telegramId);
  if (last === undefined) return false;
  if (Date.now() - last > sessionTimeoutMs) {
    sessions.delete(telegramId);
    return false;
  }
  return true;
}

export function login(telegramId: string): void {
  sessions.set(telegramId, Date.now());
}

export function logout(telegramId: string): void {
  sessions.delete(telegramId);
}

export function touch(telegramId: string): void {
  if (sessions.has(telegramId)) sessions.set(telegramId, Date.now());
}

export function sessionTimeoutMinutes(): number {
  return env.SESSION_TIMEOUT_MINUTES;
}