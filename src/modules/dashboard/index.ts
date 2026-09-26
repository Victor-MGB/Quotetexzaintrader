import { Composer, InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { escapeHtml } from "../../shared/html.js";
import { requireSession } from "../../shared/requireSession.js";
import { findUserByTelegramId } from "../auth/users.js";
import { referralLink } from "../referrals/screen.js";
import { totalsForReferrer } from "../referrals/store.js";
import { userTotals } from "../transactions/store.js";
import { historyScreen } from "../transactions/user.js";

const dash = new Composer<AppContext>();

function money(value: number): string {
  return `$${Number(value).toLocaleString("en-US")}`;
}

async function renderDashboard(ctx: AppContext): Promise<void> {
  const id = String(ctx.from?.id ?? 0);
  const [user, stats, referrals] = await Promise.all([
    findUserByTelegramId(id),
    userTotals(id),
    totalsForReferrer(id),
  ]);

  // Name and email are user controlled and this is an HTML message, so escape both.
  const name = escapeHtml(ctx.from?.username ? `@${ctx.from.username}` : (user?.firstName ?? "there"));
  const email = user?.email ? `📧 ${escapeHtml(user.email)}` : "";
  const memberSince = user ? user.createdAt.toISOString().slice(0, 10) : "—";

  const text = [
    `📊 <b>Your dashboard</b>`,
    "",
    `💰 <b>Balance: ${money(user?.balance ?? 0)}</b>`,
    "",
    `👤 ${name}`,
    // Spread so the intentional blank lines above survive; filter(Boolean) would eat them.
    ...(email ? [email] : []),
    `🆔 <code>${id}</code> · member since ${memberSince}`,
    "",
    `📥 Deposited: ${money(stats.approvedIn)}`,
    `📤 Withdrawn: ${money(stats.approvedOut)}`,
    "",
    `🤝 Referrals: ${referrals.joined} joined · ${referrals.qualified} qualified · ${referrals.paid} paid`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text("💳 Deposit", "main:deposit")
    .text("🏦 Withdrawal", "main:withdraw")
    .row()
    .text("💼 Plans", "plans:list")
    .text("🧾 History", "main:history");

  if (referralLink(id)) kb.row().text("🤝 Referral link", "main:referral");
  kb.row().text("🏠 Main Menu", "main:menu");

  await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
}

dash.command("dashboard", async (ctx) => {
  if (!(await requireSession(ctx))) return;
  await renderDashboard(ctx);
});

dash.callbackQuery("main:dashboard", async (ctx) => {
  if (!(await requireSession(ctx))) return;
  await ctx.answerCallbackQuery();
  await renderDashboard(ctx);
});

dash.callbackQuery("main:history", async (ctx) => {
  if (!(await requireSession(ctx))) return;
  await ctx.answerCallbackQuery();
  await historyScreen(ctx);
});

export { dash };
