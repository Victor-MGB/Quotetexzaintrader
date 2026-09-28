import { Composer, type InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { isAdmin, isAllowed } from "../admin/store.js";
import { loginKeyboard, registerKeyboard } from "../auth/index.js";
import { isLoggedIn } from "../auth/session.js";
import { findUserByTelegramId } from "../auth/users.js";
import { consumeReferralNote } from "../referrals/index.js";

const start = new Composer<AppContext>();

start.command("start", async (ctx) => {
  const from = ctx.from;
  const handle = from?.first_name ?? "dear";
  const id = String(from?.id ?? 0);
  // Attribution already happened in referralCapture, which runs ahead of the
  // whitelist gate, so here we only surface the outcome to the member.
  const referred = consumeReferralNote(id);

  // adminGate has already put their request in front of the admin, so the
  // approval notice below is the news, not a second copy of it.
  const approved = isAdmin(id) || isAllowed(id);
  const account = approved ? await findUserByTelegramId(id).catch(() => null) : null;

  await ctx.reply(welcomeText(handle, approved, referred), {
    reply_markup: approved ? keyboardFor(id, account !== null) : undefined,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
});

/**
 * Start is an introduction, not a door.
 *
 * It used to carry a "Main Menu" button, and that single button was most of the
 * access complaint: a member who was still waiting on an admin approval tapped it
 * and was walked through screens they were not allowed to see, because a working
 * menu button says "you are in" whether or not the gate agrees. The same button is
 * what a member whose account has just been deleted sees, so being removed and
 * being fully admitted look identical from inside the chat.
 *
 * So the welcome is words only. Whatever the member still needs is said in words
 * too — waiting for approval, or logged out — and the menu stays behind the login
 * gate where it belongs.
 */
export function welcomeText(handle: string, approved: boolean, referred: string): string {
  const opening =
    `👋 Welcome to <b>QuotexZainTrader</b>, ${handle}!` +
    `\n\nA New York investment Bot creating opportunities for investors to maximise their profits within hours of making deposits.` +
    `\n\n<b>💡 How it works</b>\n` +
    `• Choose an investment plan\n` +
    `• Fund your wallet securely\n` +
    `• Withdraw your profits anytime`;

  if (!approved) {
    return (
      `${opening}\n\n<b>🔐 An admin has to approve you first</b>\n` +
      `Nobody gets into this bot just by sending /start. Your request is with the admin now, ` +
      `and you will be told here the moment they approve or reject it.\n\n` +
      `Nothing in the bot opens until that happens.${referred}`
    );
  }

  return `${opening}${referred}`;
}

/**
 * The one thing Start still offers an approved member: the way back in.
 *
 * With the menu button gone this is the only route off the welcome screen for
 * someone whose session has lapsed or who never finished registering, so it has to
 * live here. A member who is already logged in gets nothing, because everything
 * they can reach is already open and a button leading nowhere is worse than none.
 */
function keyboardFor(telegramId: string, hasAccount: boolean): InlineKeyboard | undefined {
  if (isLoggedIn(telegramId)) return undefined;
  return hasAccount ? loginKeyboard : registerKeyboard;
}

export { start };
