import { env } from "../../core/config.js";
import { isAdmin } from "../admin/store.js";

const sessionTimeoutMs = env.SESSION_TIMEOUT_MINUTES * 60_000;

/**
 * A login lasts SESSION_TIMEOUT_MINUTES of inactivity and is held in memory
 * only. That is deliberate and is what makes the bot behave like a website
 * rather than a saved profile: a restart signs everyone out, and an account
 * deleted by an admin stops being valid the moment the row is gone.
 */
const sessions = new Map<string, number>();

/**
 * What a member is allowed to do, given their session and whether their account
 * still exists.
 *
 * `needs-account` for a live session is the case that used to be missed: an
 * admin deleted the account, the row went, but the session map did not, so the
 * deleted member kept every button working until the process restarted. The
 * session is worthless without an account, so it is reported as a missing
 * account rather than a valid login.
 */
export type AccessVerdict = "granted" | "needs-login" | "needs-account";

export function accessVerdict(telegramId: string, hasAccount: boolean): AccessVerdict {
  if (isAdmin(telegramId)) return "granted";
  if (hasAccount) return isLoggedIn(telegramId) ? "granted" : "needs-login";
  return "needs-account";
}

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

/**
 * Sessions that have gone past the inactivity limit, oldest first. Reported
 * rather than cleared so the caller can tell the member their session ended
 * before dropping it, which is the only way they find out without tapping
 * something and being refused.
 */
export function expiredSessions(): string[] {
  const now = Date.now();
  return [...sessions.entries()]
    .filter(([, last]) => now - last > sessionTimeoutMs)
    .sort((a, b) => a[1] - b[1])
    .map(([telegramId]) => telegramId);
}

export function sessionTimeoutMinutes(): number {
  return env.SESSION_TIMEOUT_MINUTES;
}
