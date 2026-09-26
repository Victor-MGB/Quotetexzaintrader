import { InlineKeyboard } from "grammy";
import { bot, type AppContext } from "../../core/bot.js";
import { env } from "../../core/config.js";
import { escapeHtml } from "../../shared/html.js";
import { REFERRAL_PREFIX, listByReferrer, totalsForReferrer } from "./store.js";

export const REFERRAL_REWARD = 10;
const SHARE_TEXT = "Join me on QuotexZainTrader — open your account through my referral link.";

/**
 * Reads the username from config first so the link still renders before
 * bot.init() resolves, falling back to the value Telegram returned at runtime.
 */
export function botUsername(): string {
  return (env.BOT_USERNAME ?? bot.botInfo.username ?? "").replace(/^@/, "");
}

export function referralLink(telegramId: string): string {
  const username = botUsername();
  return username ? `https://t.me/${username}?start=${REFERRAL_PREFIX}${telegramId}` : "";
}

export function shareUrl(link: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`;
}

function inviteeLine(row: { inviteeId: string; status: string; rewardPaid: boolean }): string {
  const mark = row.rewardPaid ? "✅ paid" : row.status === "qualified" ? "🎁 qualified" : "⏳ pending";
  return `• <code>${escapeHtml(row.inviteeId)}</code> — ${mark}`;
}

export async function referralScreen(ctx: AppContext): Promise<void> {
  const id = String(ctx.from?.id ?? 0);
  const link = referralLink(id);

  if (!link) {
    await ctx.reply(
      "🔗 Your referral link is not ready yet. Please try again in a moment — the bot username is still loading.",
    );
    return;
  }

  const [totals, invitees] = await Promise.all([totalsForReferrer(id), listByReferrer(id)]);

  const text = [
    `🤝 <b>Your referral link</b>`,
    "",
    "Share this link with anyone you know. You earn $" + REFERRAL_REWARD + " for every member who joins through it and completes a deposit plus their first plan session.",
    "",
    `<pre>${escapeHtml(link)}</pre>`,
    "",
    `👥 Joined: <b>${totals.joined}</b>`,
    `🎁 Qualified: <b>${totals.qualified}</b>`,
    `✅ Rewards paid: <b>${totals.paid}</b>`,
    invitees.length ? `\n<b>Your referrals</b>\n${invitees.map(inviteeLine).join("\n")}` : "",
    "",
    "Rewards are credited once your referral's first plan session is complete.",
  ]
    .filter(Boolean)
    .join("\n");

  const kb = new InlineKeyboard()
    .url("📤 Share your link", shareUrl(link))
    .row()
    .text("♻️ Refresh", "main:referral")
    .row()
    .text("⬅ Back", "main:promo");

  await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}
