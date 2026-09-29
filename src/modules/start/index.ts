import { Composer, type InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { isAdmin, isAllowed } from "../admin/store.js";
import { loginKeyboard, registerKeyboard } from "../auth/index.js";
import { isLoggedIn } from "../auth/session.js";
import { findUserByTelegramId } from "../auth/users.js";
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
 * The welcome used to carry a "Main Menu" button for everyone, and that single
 * button was most of the access complaint: a member who was still waiting on an
 * admin approval tapped it and was walked through screens they were not allowed
 * to see, because a working menu button says "you are in" whether or not the gate
 * agrees.
 *
 * The fix was to scope the button, not to remove it forever. An unapproved member
 * now gets this screen as words only, with no keyboard attached at all. An
 * approved member gets the button that matches where they actually are — Register,
 * Login, or Main Menu — so the screen always says the same thing the gate would
 * say. The gate, not this screen, is what decides what opens; memberGate sits
 * ahead of every one of them.
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
 * What the welcome screen offers, decided by how far through the door they are.
 *
 * Three states, and each one is the honest one for that member:
 *
 *  - Not approved. No keyboard at all. They are not merely unlogged in, they are
 *    not admitted, and a Register button here would be a dead end. adminGate has
 *    already put their request in front of the admin.
 *  - Approved, no live session. The way in: Login if an account exists, Register
 *    if it does not. This is the only route off the welcome for someone whose
 *    session lapsed or who never finished registering.
 *  - Approved and logged in. The Main Menu button. This is the one that used to be
 *    gone for everyone, and that is what left an approved member tapping /start and
 *    finding nothing to click. Carrying it here is safe because memberGate sits
 *    ahead of the main menu, so a session that lapses between the tap and the
 *    screen is caught there and answered with the login prompt rather than a menu
 *    they are not entitled to.
 */
function keyboardFor(telegramId: string, hasAccount: boolean): InlineKeyboard | undefined {
  if (isLoggedIn(telegramId)) return mainMenuButton();
  return hasAccount ? loginKeyboard : registerKeyboard;
}

export { start, keyboardFor };
