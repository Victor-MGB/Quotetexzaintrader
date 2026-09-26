import { Composer } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { mainMenuButton } from "../main/index.js";
import { consumeReferralNote } from "../referrals/index.js";

const start = new Composer<AppContext>();

start.command("start", async (ctx) => {
  const from = ctx.from;
  const handle = from?.first_name ?? "dear";
  // Attribution already happened in referralCapture, which runs ahead of the
  // whitelist gate, so here we only surface the outcome to the member.
  const referred = consumeReferralNote(String(from?.id ?? 0));

  await ctx.reply(
    `🚀 Welcome to <b>QuotexZainTrader</b>, ${handle}!

A New York investment Bot creating opportunities for investors to maximise their profits within hours of making deposits.

<b>💡 How it works</b>
• Choose an investment plan
• Fund your wallet securely
• Withdraw your profits anytime

Start your journey to financial freedom today.${referred}`,
    {
      reply_markup: mainMenuButton(),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    },
  );
});

export { start };