import { Composer, InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { describeDeposit, describeDepositStatus } from "../../core/settings.js";
import { escapeHtml } from "../../shared/html.js";
import {
  countUsers,
  countUsersSince,
} from "../auth/users.js";
import { WALLETS } from "../main/content.js";
import { grandTotals } from "../referrals/store.js";
import {
  isAdmin,
  isLocked,
  isPermanentAdmin,
  listAdmins,
  listAllowed,
  demoteAdmin,
  promoteAdmin,
} from "../admin/store.js";
import { invalidateMenu, refreshMenu } from "../menu.js";
import { describeTransaction } from "../transactions/admin.js";
import { countByStatus, listByStatus } from "../transactions/store.js";

const dash = new Composer<AppContext>();

function guard(ctx: AppContext): boolean {
  return isAdmin(String(ctx.from?.id ?? 0));
}

function adminKeyboard(pending: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("👥 Users", "admin:users_0")
    .text("🔗 Referrals", "admin:referrals_0")
    .row()
    .text("🛡 Admins", "admin:admins");

  if (pending > 0) {
    kb.row().text(`📋 Pending (${pending})`, "admin:txn_queue_0");
  }
  return kb;
}

async function buildAdminDashboard(): Promise<{ text: string; pending: number }> {
  const [userTotal, daySignups, allowed, referrals, pending, addresses, locked] = await Promise.all([
    countUsers(),
    countUsersSince(new Date(Date.now() - 86_400_000)),
    listAllowed(),
    grandTotals(),
    countByStatus("pending"),
    Promise.all(WALLETS.map(async (w) => describeDepositStatus(await describeDeposit(w)))),
    Promise.resolve(isLocked()),
  ]);

  const ready = addresses.filter((line) => !/missing|not set/i.test(line)).length;
  const text = [
    `🛠 <b>Admin dashboard</b>`,
    "",
    `👥 Registered users: <b>${userTotal}</b> (${daySignups} in the last 24h)`,
    `✅ Whitelisted: <b>${allowed.length}</b>`,
    `🤝 Referrals: ${referrals.joined} joined · ${referrals.qualified} qualified · ${referrals.paid} paid`,
    `⏳ Pending requests: <b>${pending}</b>`,
    `💳 Deposit addresses ready: ${ready}/${WALLETS.length}`,
    `🔒 Bot locked: ${locked ? "yes" : "no"}`,
  ].join("\n");

  return { text, pending };
}

dash.command("admin", async (ctx) => {
  if (!guard(ctx)) return;

  const { text, pending } = await buildAdminDashboard();
  const kb = adminKeyboard(pending);
  await ctx.reply(text, { reply_markup: kb.inline_keyboard.length ? kb : undefined, parse_mode: "HTML" });
});

dash.callbackQuery("admin:dashboard", async (ctx) => {
  if (!guard(ctx)) return;
  await ctx.answerCallbackQuery();

  const { text, pending } = await buildAdminDashboard();
  const kb = adminKeyboard(pending);
  await ctx.editMessageText(text, { reply_markup: kb.inline_keyboard.length ? kb : undefined, parse_mode: "HTML" });
});

dash.callbackQuery("admin:admins", async (ctx) => {
  if (!guard(ctx)) return;
  await ctx.answerCallbackQuery();

  const entries = await listAdmins();
  const text = [
    `🛡 <b>Admins</b> — ${entries.length} total`,
    "",
    ...entries.map((entry) =>
      entry.permanent
        ? `🔒 <code>${entry.telegramId}</code> — permanent (ADMIN_IDS)`
        : `⭐ <code>${entry.telegramId}</code> — promoted`,
    ),
    "",
    "Use <code>/promote &lt;telegram-id&gt;</code> or <code>/demote &lt;telegram-id&gt;</code>.",
  ].join("\n");

  const kb = new InlineKeyboard().text("⬅ Back", "admin:dashboard");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
});

/** Same convention as the admin module: grammy puts the bare argument in ctx.match. */
function idFromArgs(ctx: AppContext): string | null {
  const text = typeof ctx.match === "string" ? ctx.match.trim() : "";
  return text && /^\d+$/.test(text) ? text : null;
}

dash.command("promote", async (ctx) => {
  if (!guard(ctx)) return;

  const target = idFromArgs(ctx);
  if (!target) {
    await ctx.reply("Usage: /promote <telegram-id>");
    return;
  }
  if (target === String(ctx.from?.id ?? 0)) {
    await ctx.reply("You are already an admin.");
    return;
  }

  const added = await promoteAdmin(target, String(ctx.from?.id ?? 0));
  await ctx.reply(
    added
      ? `⭐ <code>${escapeHtml(target)}</code> is now an admin. They can use /admin and every admin command.`
      : `<code>${escapeHtml(target)}</code> is already an admin.`,
    { parse_mode: "HTML" },
  );

  // Push the admin command list to their chat menu straight away.
  invalidateMenu(Number(target));
  await refreshMenu({ id: Number(target), is_bot: false, first_name: "" }).catch(() => undefined);
});

dash.command("demote", async (ctx) => {
  if (!guard(ctx)) return;

  const self = String(ctx.from?.id ?? 0);
  const target = idFromArgs(ctx);
  if (!target) {
    await ctx.reply("Usage: /demote <telegram-id>");
    return;
  }
  if (target === self) {
    await ctx.reply("You cannot demote yourself. Ask another admin to do it.");
    return;
  }
  if (isPermanentAdmin(target)) {
    await ctx.reply(
      `<code>${escapeHtml(target)}</code> is a permanent admin from ADMIN_IDS. Remove it from the environment to demote.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const removed = await demoteAdmin(target);
  invalidateMenu(Number(target));
  await ctx.reply(
    removed
      ? `⛔ <code>${escapeHtml(target)}</code> is no longer an admin.`
          : `<code>${escapeHtml(target)}</code> was not a promoted admin.`,
    { parse_mode: "HTML" },
  );
});

const QUEUE_PER_PAGE = 6;

dash.callbackQuery(/^admin:txn_queue_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const page = Number(ctx.match[1] ?? 0);
  const rows = await listByStatus("pending", 100);
  const pages = Math.max(1, Math.ceil(rows.length / QUEUE_PER_PAGE));
  const target = Math.min(Math.max(page, 0), pages - 1);
  const slice = rows.slice(target * QUEUE_PER_PAGE, target * QUEUE_PER_PAGE + QUEUE_PER_PAGE);

  const text = slice.length
    ? [
        `📋 <b>Pending requests</b> — ${rows.length} · page ${target + 1}/${pages}`,
        "",
        ...slice.map((row) => `${describeTransaction(row)}`),
      ].join("\n\n")
    : "📋 <b>Pending requests</b>\n\nNothing is waiting. 🎉";

  const kb = new InlineKeyboard();
  if (target > 0) kb.text("⬅ Prev", `admin:txn_queue_${target - 1}`);
  if (target < pages - 1) kb.text("Next ➡", `admin:txn_queue_${target + 1}`);
  kb.row().text("⬅ Back", "admin:dashboard");

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
});

export { dash };
