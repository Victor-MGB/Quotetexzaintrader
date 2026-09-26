import { Composer } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { mainMenuKeyboard } from "../main/index.js";

const start = new Composer<AppContext>();

start.command("start", async (ctx) => {
  const from = ctx.from;
  const handle = from?.first_name ?? "dear";

  await ctx.reply(
    `🚀 Welcome to <b>QuotexZainTrader</b>, ${handle}!

A New York investment Bot creating opportunities for investors to maximise their profits within hours of making deposits.

<b>💡 How it works</b>
• Choose an investment plan
• Fund your wallet securely
• Withdraw your profits anytime

Start your journey to financial freedom today.`,
    {
      reply_markup: mainMenuKeyboard(),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    },
  );
});

export { start };