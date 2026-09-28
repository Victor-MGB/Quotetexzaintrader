import type { AppContext } from "../core/bot.js";
import { loginKeyboard, registerKeyboard } from "../modules/auth/index.js";
import { accessVerdict, logout, sessionTimeoutMinutes, touch } from "../modules/auth/session.js";
import { findUserByTelegramId } from "../modules/auth/users.js";

/**
 * The single place that decides whether a member may act.
 *
 * Both halves of the check matter. The session is what expires after 30 minutes
 * of silence, and the account lookup is what stops a deleted member from riding
 * a session that outlived their row. A member with neither is asked to register,
 * which is the answer a brand new Telegram user and a just-deleted one both
 * deserve.
 */
export async function requireSession(ctx: AppContext): Promise<boolean> {
  const id = String(ctx.from?.id ?? 0);

  const user = await findUserByTelegramId(id).catch(() => null);
  const verdict = accessVerdict(id, user !== null);

  if (verdict === "granted") {
    touch(id);
    return true;
  }

  // A session whose account is gone is not a login, so it is cleared here rather
  // than left to expire on its own another 29 minutes later.
  if (verdict === "needs-account") logout(id);

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery(verdict === "needs-login" ? "Session expired" : "Account required").catch(
      () => undefined,
    );
  }

  await ctx.reply(screenFor(verdict, id), {
    reply_markup: verdict === "needs-login" ? loginKeyboard : registerKeyboard,
  });
  return false;
}

function screenFor(verdict: "needs-login" | "needs-account", id: string): string {
  // The number is read from the config rather than written into the sentence, so
  // changing SESSION_TIMEOUT_MINUTES cannot leave the bot claiming a limit it is
  // not enforcing.
  if (verdict === "needs-login") {
    return `⏰ Your session ended after ${sessionTimeoutMinutes()} minutes of inactivity.

For your security, please log in again before you continue.`;
  }

  return `👋 You need an account to continue.

🆔 Your Telegram ID: ${id}

Create an account to deposit, withdraw, and track your balance. An admin has to approve you before anything here opens.`;
}
