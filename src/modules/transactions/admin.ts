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
  return row.type === "deposit" ? "💳 Deposit" : "🏦 Withdrawal";
}

export function describeTransaction(row: TransactionRow): string {
  const wallet = row.method ? walletByKey(row.method) : null;
  const method = row.method ? (wallet ? `${wallet.asset} (${wallet.label})` : row.method) : null;
  const amount = row.amount === null ? "not confirmed yet" : `$${row.amount}`;

  return [
    `${STATUS_ICON[row.status]} <b>${typeLabel(row)}</b> — #${row.id}`,
    `👤 <code>${escapeHtml(row.telegramId)}</code>`,
    `💵 Amount: <b>${escapeHtml(amount)}</b>`,
    method ? `🪙 Method: ${escapeHtml(method)}` : "",
    row.reference ? `🧾 Hash: <code>${escapeHtml(row.reference)}</code>` : "",
    row.address ? `🏷 Payout: <code>${escapeHtml(row.address)}</code>` : "",
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

  const settled = await settle(id, "approved");
  await ctx.reply(
    settled
      ? `✅ Approved #${id}.\n\n${describeTransaction(settled)}\n\nBalance updated.`
      : `⚠️ #${id} was already handled by someone else.`,
    { parse_mode: "HTML" },
  );
});

txn.callbackQuery(/^admin:txn_reject_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = Number(ctx.match[1]);
  const settled = await settle(id, "rejected");
  await ctx.answerCallbackQuery(settled ? "Rejected" : "Already handled");
  if (settled) {
    await ctx.reply(`❌ Rejected #${id}. ${describeTransaction(settled)}`, { parse_mode: "HTML" });
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

  const settled = await settle(pending, "approved", { amount });
  if (!settled) {
    awaitingAmount.delete(id);
    await ctx.reply(`⚠️ #${pending} was already handled by someone else.`);
    return;
  }

  awaitingAmount.delete(id);
  await ctx.reply(
    `✅ Approved #${pending} at $${amount}.\n\n${describeTransaction(settled)}\n\nBalance credited.`,
    { parse_mode: "HTML" },
  );
});

export { txn };
