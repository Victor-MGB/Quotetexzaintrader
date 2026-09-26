import type { AppContext } from "../core/bot.js";
import { loginKeyboard, registerKeyboard } from "../modules/auth/index.js";
import { isLoggedIn, touch } from "../modules/auth/session.js";
import { findUserByTelegramId } from "../modules/auth/users.js";

export async function requireSession(ctx: AppContext): Promise<boolean> {
  const id = String(ctx.from?.id ?? 0);
  if (isLoggedIn(id)) {
    touch(id);
    return true;
  }

  // A member who never registered and one whose session merely lapsed need
  // different wording, otherwise a first-time user is told they "expired".
  const registered = await findUserByTelegramId(id).catch(() => null);

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery(registered ? "Session expired" : "Account required").catch(() => undefined);
  }

  const text = registered
    ? `⏰ Your session is inactive or expired.

For your security, please login again before performing any task.`
    : `👋 You need an account to continue.

Create an account to deposit, withdraw, and track your balance.`;

  await ctx.reply(text, { reply_markup: registered ? loginKeyboard : registerKeyboard });
  return false;
}
