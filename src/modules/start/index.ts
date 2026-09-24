import { Composer, InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";

const start = new Composer<AppContext>();

const menuKeyboard = new InlineKeyboard().text("View Plans", "plans:view");

start.command("start", async (ctx) => {
  const from = ctx.from;
  const handle = from?.first_name ?? "dear";

  await ctx.reply(
    `Welcome to QuotexZainTrader, ${handle}! 🚀

Your account is ready to grow.

• Choose an investment plan
• Fund your wallet securely
• Withdraw your profits anytime`,
    { reply_markup: menuKeyboard, link_preview_options: { is_disabled: true } },
  );
});

export { start };