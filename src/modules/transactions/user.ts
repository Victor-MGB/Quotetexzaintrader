import { InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { escapeHtml } from "../../shared/html.js";
import { listByUser, type TransactionRow } from "./store.js";

const STATUS_ICON: Record<TransactionRow["status"], string> = {
  pending: "⏳",
  approved: "✅",
  rejected: "❌",
};

const STATUS_TEXT: Record<TransactionRow["status"], string> = {
  pending: "pending review",
  approved: "approved",
  rejected: "rejected",
};

function line(row: TransactionRow): string {
  const label = row.type === "deposit" ? "Deposit" : "Withdrawal";
  // A deposit has no amount until an admin verifies the chain hash.
  const amount =
    row.amount === null
      ? "amount pending"
      : row.type === "deposit"
        ? `+$${row.amount}`
        : `−$${row.amount}`;
  return `${STATUS_ICON[row.status]} <b>${label}</b> ${escapeHtml(amount)} · ${STATUS_TEXT[row.status]}
   #${row.id} · ${row.createdAt.toISOString().slice(0, 10)}`;
}

export async function historyScreen(ctx: AppContext): Promise<void> {
  const id = String(ctx.from?.id ?? 0);
  const rows = await listByUser(id);

  const text = rows.length
    ? [`🧾 <b>Transaction history</b>`, "", ...rows.map(line)].join("\n")
    : "🧾 <b>Transaction history</b>\n\nNothing here yet. Your deposits and withdrawals will appear once you make them.";

  const kb = new InlineKeyboard().text("⬅ Back", "main:dashboard");
  await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
}
