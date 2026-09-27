import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { bot } from "../../core/bot.js";
import { adminIds } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { escapeHtml } from "../../shared/html.js";
import { isAdmin } from "../admin/store.js";
import { walletByKey } from "../main/content.js";
import { findTransaction, settle, type TransactionRow } from "./store.js";

const txn = new Composer<AppContext>();

/** Admins who tapped Approve on a deposit and now owe us the verified amount. */
const awaitingAmount = new Map<string, number>();

const STATUS_ICON: Record<TransactionRow["status"], string> = {
  pending: "⏳",
  approved: "✅",
  rejected: "❌",
};

function guard(ctx: AppContext): boolean {
  if (isAdmin(String(ctx.from?.id ?? 0))) return true;
  void ctx.answerCallbackQuery("Admins only").catch(() => undefined);
  return false;
}

function typeLabel(row: TransactionRow): string {
  if (row.type === "deposit") return "💳 Deposit";
  if (row.type === "withdrawal") return "🏦 Withdrawal";
  return "⚙️ Admin adjustment";
}

export function describeTransaction(row: TransactionRow): string {
  const wallet = row.method ? walletByKey(row.method) : null;
  const method = row.method ? (wallet ? `${wallet.asset} (${wallet.label})` : row.method) : null;
  // An adjustment already carries its own sign, deposits and withdrawals do not.
  const amount =
    row.amount === null
      ? "not confirmed yet"
      : row.type === "adjustment"
        ? `${row.amount >= 0 ? "+" : "−"}$${Math.abs(row.amount)}`
        : `$${row.amount}`;

  return [
    `${STATUS_ICON[row.status]} <b>${typeLabel(row)}</b> — #${row.id}`,
    `👤 <code>${escapeHtml(row.telegramId)}</code>`,
    `💵 Amount: <b>${escapeHtml(amount)}</b>`,
    method ? `🪙 Method: ${escapeHtml(method)}` : "",
    row.reference ? `🧾 Hash: <code>${escapeHtml(row.reference)}</code>` : "",
    row.address ? `🏷 Payout: <code>${escapeHtml(row.address)}</code>` : "",
    row.note ? `📝 Note: ${escapeHtml(row.note)}` : "",
    `🕐 ${row.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ]
    .filter(Boolean)
    .join("\n");
}

function pendingKeyboard(row: TransactionRow): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("✅ Approve", `admin:txn_approve_${row.id}`)
    .text("❌ Reject", `admin:txn_reject_${row.id}`);
  return kb.row().text("⬅ Back to queue", "admin:dashboard");
}

export async function notifyAdminsTransaction(row: TransactionRow, header: string, body: string): Promise<void> {
  const text = `${header}\n\n${body}\n\n${describeTransaction(row)}`;

  for (const adminId of adminIds) {
    await bot.api
      .sendMessage(adminId, text, { reply_markup: pendingKeyboard(row), parse_mode: "HTML" })
      .catch((err) => logger.warn({ err, adminId }, "failed to notify admin"));
  }
}

txn.callbackQuery(/^admin:txn_approve_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = Number(ctx.match[1]);
  const row = await findTransaction(id);
  if (!row) {
    await ctx.answerCallbackQuery("Transaction not found");
    return;
  }
  if (row.status !== "pending") {
    await ctx.answerCallbackQuery(`Already ${row.status}`);
    return;
  }

  await ctx.answerCallbackQuery();

  if (row.type === "deposit" && row.amount === null) {
    // The member only sent a hash, so the amount comes from the admin who verified it.
    awaitingAmount.set(String(ctx.from?.id ?? 0), id);
    await ctx.reply(
      `💳 <b>Deposit #${id}</b> — how much did you verify on the network?

Send the USD amount you received, for example 500.`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("✖ Cancel", `admin:txn_cancel_${id}`) },
    );
    return;
  }

  const result = await settle(id, "approved");
  if (result.ok) {
    await ctx.reply(`✅ Approved #${id}.\n\n${describeTransaction(result.row)}\n\nBalance updated.`, { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(settleFailureText(result, id), { parse_mode: "HTML" });
});

/**
 * A withdrawal that no longer covers the balance is a different problem from one
 * another admin already handled, so it gets its own wording. It stays pending on
 * purpose: topping the balance up and approving it again is the intended fix.
 */
function settleFailureText(result: { reason: string; requested?: number; available?: number }, id: number): string {
  if (result.reason === "insufficient_funds") {
    return `⚠️ Cannot approve #${id} — the member does not have the funds.

Requested: $${result.requested ?? 0}
Available: $${result.available ?? 0}

The request stays pending. Top the balance up from Users, or reject it.`;
  }
  return `⚠️ #${id} was already handled by someone else.`;
}

txn.callbackQuery(/^admin:txn_reject_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = Number(ctx.match[1]);
  const result = await settle(id, "rejected");
  await ctx.answerCallbackQuery(result.ok ? "Rejected" : "Already handled");
  if (result.ok) {
    await ctx.reply(`❌ Rejected #${id}. ${describeTransaction(result.row)}`, { parse_mode: "HTML" });
  }
});

txn.callbackQuery(/^admin:txn_cancel_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  // Abandons the prompt only. The transaction stays pending and the amount is never guessed.
  awaitingAmount.delete(String(ctx.from?.id ?? 0));
  await ctx.answerCallbackQuery("Cancelled");
  await ctx.reply("Cancelled. The request is still pending — reopen it from the queue when you have the amount.");
});

txn.on("message:text", async (ctx, next: NextFunction) => {
  const id = String(ctx.from?.id ?? 0);
  const pending = awaitingAmount.get(id);
  if (pending === undefined || !isAdmin(id)) return next();

  const text = ctx.message.text.trim();
  // A command is never an amount, so let it reach its own handler.
  if (text.startsWith("/")) return next();

  const amount = Number(text.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    // Keep the state so a typo can be retried instead of stranding the request.
    await ctx.reply(
      "That is not a valid amount. Send the USD figure you verified, for example 500 — or tap Cancel to abort.",
    );
    return;
  }

  const result = await settle(pending, "approved", { amount });
  if (!result.ok) {
    if (result.reason === "not_pending") awaitingAmount.delete(id);
    await ctx.reply(settleFailureText(result, pending), { parse_mode: "HTML" });
    return;
  }

  awaitingAmount.delete(id);
  await ctx.reply(
    `✅ Approved #${pending} at $${amount}.\n\n${describeTransaction(result.row)}\n\nBalance credited.`,
    { parse_mode: "HTML" },
  );
});

export { txn };
