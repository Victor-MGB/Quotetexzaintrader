import type { AppContext } from "../core/bot.js";
import { isAdmin } from "../modules/admin/store.js";

/**
 * The single place that decides whether a caller may use an admin command or an
 * admin button.
 *
 * Every admin module used to answer a refused tap with nothing at all, so a
 * mistyped command and a command that never reached its handler looked
 * identical from the outside: silence. Someone whose /allow does nothing has no
 * way to tell that they are not an admin, that they left off the argument, or
 * that the bot is broken, and all three are worth being told apart.
 *
 * Both shapes have to be answered, because they need different replies. A
 * callback query is answered with a toast on the button the user is already
 * looking at, and answering one any other way is an error Telegram rejects. A
 * typed command is answered in the chat, and a toast would throw and be
 * swallowed. So each gets the one it can actually deliver.
 */
export async function requireAdmin(ctx: AppContext): Promise<boolean> {
  if (isAdmin(String(ctx.from?.id ?? 0))) return true;

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery("Admins only").catch(() => undefined);
  }

  await ctx.reply("🔒 Admins only. If you think you should have access, ask an admin to promote you.").catch(
    () => undefined,
  );
  return false;
}
