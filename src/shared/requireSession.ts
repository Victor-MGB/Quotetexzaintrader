import type { AppContext } from "../core/bot.js";
import { loginKeyboard } from "../modules/auth/index.js";
import { isLoggedIn, touch } from "../modules/auth/session.js";

export async function requireSession(ctx: AppContext): Promise<boolean> {
  const id = String(ctx.from?.id ?? 0);
  if (isLoggedIn(id)) {
    touch(id);
    return true;
  }
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery("Session expired").catch(() => undefined);
  }
  await ctx.reply(
    `⏰ Your session is inactive or expired.

For your security, please login again before performing any task.`,
    { reply_markup: loginKeyboard },
  );
  return false;
}
