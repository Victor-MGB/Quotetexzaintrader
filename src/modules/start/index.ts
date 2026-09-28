import { Composer } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { isAdmin, isAllowed } from "../admin/store.js";
import { mainMenuButton } from "../main/index.js";
import { consumeReferralNote } from "../referrals/index.js";

const start = new Composer<AppContext>();

start.command("start", async (ctx) => {
  const from = ctx.from;
  const handle = from?.first_name ?? "dear";
  const id = String(from?.id ?? 0);
  // Attribution already happened in referralCapture, which runs ahead of the
  // whitelist gate, so here we only surface the outcome to the member.
  const referred = consumeReferralNote(id);

  // adminGate has already put their request in front of the admin. A welcome with
  // a working menu button on top of that reads as though they were let in, so
  // the menu is withheld until an admin approves them.
  if (!isAdmin(id) && !isAllowed(id)) {
    await ctx.reply(
      `👋 Welcome to <b>QuotexZainTrader</b>, ${handle}!

Your request for access is with the admin now. They will approve or reject it, and you will be told here either way.${referred}`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
    return;
  }

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