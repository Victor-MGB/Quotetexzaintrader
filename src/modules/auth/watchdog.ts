import { bot } from "../../core/bot.js";
import { logger } from "../../core/logger.js";
import { loginKeyboard } from "./index.js";
import { findUserByTelegramId } from "./users.js";
import { expiredSessions, logout, sessionTimeoutMinutes } from "./session.js";

const CHECK_INTERVAL_MS = 60_000;

/**
 * Tells a member their session has ended, without waiting for them to trip over
 * it.
 *
 * Refusing the next tap is only half of what a website does: a browser expires a
 * session and then says so. A bot cannot speak until it is spoken to, so this
 * sweeps the session map on a timer and pushes the login prompt the moment the
 * 30 minutes of inactivity are up. The session is dropped first, so a member who
 * cannot be reached (blocked the bot, deleted their account) is not retried
 * every minute.
 */
async function announceExpiry(): Promise<void> {
  for (const telegramId of expiredSessions()) {
    logout(telegramId);

    // No account means there is nothing to log in to. The member is told when they
    // next interact, and the row may be about to be recreated by a fresh request.
    const account = await findUserByTelegramId(telegramId).catch(() => null);
    if (!account) continue;

    await bot.api
      .sendMessage(
        telegramId,
        `⏰ Your session ended after ${sessionTimeoutMinutes()} minutes of inactivity.\n\n` +
          `For your security, please log in again to continue.`,
        { reply_markup: loginKeyboard },
      )
      .catch((err) => logger.warn({ err, telegramId }, "failed to tell member their session expired"));
  }
}

let timer: NodeJS.Timeout | null = null;

/** Starts the sweep. Called once at boot; a second call is a no-op. */
export function startSessionWatchdog(intervalMs: number = CHECK_INTERVAL_MS): void {
  if (timer) return;
  // unref so the sweep can never be the reason the process stays alive.
  timer = setInterval(() => {
    void announceExpiry().catch((err) => logger.error({ err }, "session sweep failed"));
  }, intervalMs);
  timer.unref();
  logger.info({ intervalMs }, "session watchdog started");
}

export function stopSessionWatchdog(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Exposed for the sweep itself and for tests. */
export { announceExpiry as sweepExpiredSessions };
