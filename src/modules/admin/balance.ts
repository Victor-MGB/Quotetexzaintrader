import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { bot } from "../../core/bot.js";
import { logger } from "../../core/logger.js";
import { escapeHtml } from "../../shared/html.js";
import { requireAdmin } from "../../shared/requireAdmin.js";
import { findUserByTelegramId, type UserRow } from "../auth/users.js";
import { buildDashboard } from "../dashboard/index.js";
import { describeTransaction } from "../transactions/admin.js";
import { adjustBalance, listByUser, userTotals, type BalanceMode } from "../transactions/store.js";
import { isAdmin } from "./store.js";

const balanceAdmin = new Composer<AppContext>();

/**
 * Balance is a Postgres integer, so nine digits is the widest figure we accept.
 * Set mode tolerates a leading "+" because admins type it out of habit, but never
 * a "-" — a negative balance is unreachable on purpose, in either mode.
 */
const FIGURE = /^\+?(\d{1,9})$/;
const SIGNED_FIGURE = /^([+-]?)(\d{1,9})$/;

/** The ceiling above, reused so a projected total is rejected with a real message. */
const MAX_BALANCE = 999_999_999;

/**
 * Admins who tapped a balance button and now owe us a figure, keyed by admin id
 * so two admins editing different members at once never cross wires. Mirrors the
 * deposit-amount prompt in the transactions module; process-local by design, so a
 * restart simply drops the prompt and the admin taps the button again.
 */
const awaitingAmount = new Map<string, { telegramId: string; mode: BalanceMode; page: number }>();

/**
 * The last balance notice pushed to each member, so the next one replaces it
 * instead of stacking a fresh dashboard into their chat on every admin edit.
 * Process-local like the rest of this bot's transient state: after a restart the
 * id is simply unknown and the member gets one extra message before it settles.
 */
const lastAlert = new Map<string, number>();

function money(value: number): string {
  return `$${Number(value).toLocaleString("en-US")}`;
}

function displayName(user: UserRow): string {
  return user.username ? `@${user.username}` : (user.firstName ?? "no name");
}

/** Tappable row in the admin user list. Page is carried through so Back returns where it came from. */
export function userButton(user: UserRow, page: number): { text: string; data: string } {
  return {
    text: `#${user.id} · ${displayName(user)} · ${money(user.balance)}`,
    data: `admin:user_${page}_${user.telegramId}`,
  };
}

function detailKeyboard(page: number, telegramId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("💵 Set Balance", `admin:user_set_${page}_${telegramId}`)
    .text("➕ Add / ➖ Remove", `admin:user_adj_${page}_${telegramId}`)
    .row()
    .text("🧾 Their history", `admin:user_hist_${page}_${telegramId}`)
    .row()
    .text("⬅ Back to users", `admin:users_${page}`);
}

async function memberScreen(page: number, telegramId: string): Promise<{ text: string; markup: InlineKeyboard } | null> {
  const user = await findUserByTelegramId(telegramId);
  if (!user) return null;

  const totals = await userTotals(telegramId);

  const text = [
    `👤 <b>Member #${user.id}</b>`,
    "",
    `🆔 <code>${escapeHtml(user.telegramId)}</code>`,
    `🏷 ${escapeHtml(displayName(user))}`,
    ...(user.email ? [`📧 ${escapeHtml(user.email)}`] : []),
    "",
    `💰 <b>Balance: ${money(user.balance)}</b>`,
    `📥 Deposited: ${money(totals.approvedIn)} · 📤 Withdrawn: ${money(totals.approvedOut)}`,
    ...(totals.adjustments === 0
      ? []
      : [`⚙️ Admin adjustments to date: ${totals.adjustments >= 0 ? "+" : "−"}${money(Math.abs(totals.adjustments))}`]),
    `📅 Member since ${user.createdAt.toISOString().slice(0, 10)}`,
    "",
    "Set or adjust the balance below and it is written to this member's ledger, then their dashboard is pushed to them straight away.",
  ].join("\n");

  return { text, markup: detailKeyboard(page, telegramId) };
}

balanceAdmin.callbackQuery(/^admin:user_(\d+)_(\d+)$/, async (ctx) => {
  if (!(await requireAdmin(ctx))) return;

  const page = Number(ctx.match[1] ?? 0);
  const telegramId = ctx.match[2];
  if (!telegramId) return;

  await ctx.answerCallbackQuery();
  const view = await memberScreen(page, telegramId);
  if (!view) {
    await ctx.editMessageText(`⚠️ No account with Telegram ID ${escapeHtml(telegramId)}.`);
    return;
  }
  await ctx.editMessageText(view.text, { reply_markup: view.markup, parse_mode: "HTML" });
});

balanceAdmin.callbackQuery(/^admin:user_set_(\d+)_(\d+)$/, async (ctx) => {
  if (!(await requireAdmin(ctx))) return;

  const page = Number(ctx.match[1] ?? 0);
  const telegramId = ctx.match[2];
  if (!telegramId) return;
  const user = await findUserByTelegramId(telegramId);
  if (!user) {
    await ctx.answerCallbackQuery("No such member");
    return;
  }

  await ctx.answerCallbackQuery();
  awaitingAmount.set(String(ctx.from?.id ?? 0), { telegramId, mode: "set", page });
  await ctx.reply(
    `💵 <b>Set balance for ${escapeHtml(displayName(user))}</b>\n\n` +
      `Current balance: <b>${money(user.balance)}</b>\n\n` +
      `Send the new balance in USD, for example 500. This overwrites the current figure.\n` +
      `The value must be a whole, non-negative number.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("✖ Cancel", "admin:bal_cancel"),
    },
  );
});

balanceAdmin.callbackQuery(/^admin:user_adj_(\d+)_(\d+)$/, async (ctx) => {
  if (!(await requireAdmin(ctx))) return;

  const page = Number(ctx.match[1] ?? 0);
  const telegramId = ctx.match[2];
  if (!telegramId) return;
  const user = await findUserByTelegramId(telegramId);
  if (!user) {
    await ctx.answerCallbackQuery("No such member");
    return;
  }

  await ctx.answerCallbackQuery();
  awaitingAmount.set(String(ctx.from?.id ?? 0), { telegramId, mode: "add", page });
  await ctx.reply(
    `➕ <b>Adjust balance for ${escapeHtml(displayName(user))}</b>\n\n` +
      `Current balance: <b>${money(user.balance)}</b>\n\n` +
      `Send the change in USD, for example:\n` +
      `<code>+500</code> to credit 500\n` +
      `<code>-200</code> to deduct 200\n` +
      `<code>500</code> also credits 500\n\n` +
      `The balance cannot be pushed below $0.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("✖ Cancel", "admin:bal_cancel"),
    },
  );
});

balanceAdmin.callbackQuery("admin:bal_cancel", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  awaitingAmount.delete(String(ctx.from?.id ?? 0));
  await ctx.answerCallbackQuery("Cancelled");
  await ctx.reply("Cancelled. The balance was not changed.");
});

balanceAdmin.callbackQuery(/^admin:user_hist_(\d+)_(\d+)$/, async (ctx) => {
  if (!(await requireAdmin(ctx))) return;

  const page = Number(ctx.match[1] ?? 0);
  const telegramId = ctx.match[2];
  if (!telegramId) return;

  await ctx.answerCallbackQuery();
  const rows = await listByUser(telegramId, 10);
  const text = rows.length
    ? [`🧾 <b>History — ${escapeHtml(telegramId)}</b>`, "", ...rows.map((row) => describeTransaction(row))].join("\n\n")
    : `🧾 <b>History — ${escapeHtml(telegramId)}</b>\n\nNothing recorded yet.`;

  const kb = new InlineKeyboard().text("⬅ Back to member", `admin:user_${page}_${telegramId}`);
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
});

/**
 * Adjust mode accepts a leading sign, set mode does not. Returns null for anything
 * that is not a plain figure so the admin gets a retry instead of a silent no-op.
 */
function parseFigure(raw: string, mode: BalanceMode): { mode: BalanceMode; value: number } | null {
  if (mode === "set") {
    const match = FIGURE.exec(raw);
    return match?.[1] ? { mode: "set", value: Number(match[1]) } : null;
  }

  const match = SIGNED_FIGURE.exec(raw);
  if (!match?.[2]) return null;
  const value = Number(match[2]);
  return match[1] === "-" ? { mode: "subtract", value } : { mode: "add", value };
}

function project(balance: number, figure: { mode: BalanceMode; value: number }): number {
  if (figure.mode === "set") return figure.value;
  return figure.mode === "add" ? balance + figure.value : balance - figure.value;
}

/** Mirrors the verb shown in the confirmation so both read the same way. */
function actionVerb(figure: { mode: BalanceMode; value: number }): string {
  if (figure.mode === "set") return "set to";
  return figure.mode === "add" ? `credited by ${money(figure.value)}` : `deducted ${money(figure.value)}`;
}

/**
 * What the member reads on their own phone. It states the direction and the
 * figure that actually moved, because a member whose balance fell with no
 * explanation is the one who ends up messaging support. Nothing here names the
 * admin or the mechanism — the member only needs to know their money moved.
 */
function balanceAlert(delta: number, previous: number, balance: number): string {
  if (delta === 0) {
    return ["ℹ️ Your balance is unchanged", "", `💰 Balance: ${money(balance)}`].join("\n");
  }

  const credited = delta > 0;
  return [
    credited ? "✅ Your account has been credited" : "⚠️ Your account has been debited",
    "",
    `💵 ${credited ? "Credited" : "Debited"}: ${money(Math.abs(delta))}`,
    `💰 Previous balance: ${money(previous)}`,
    `💰 New balance: ${money(balance)}`,
  ].join("\n");
}

balanceAdmin.on("message:text", async (ctx, next: NextFunction) => {
  const id = String(ctx.from?.id ?? 0);
  const pending = awaitingAmount.get(id);
  if (!pending || !isAdmin(id)) return next();

  // A command is never an amount, so let it reach its own handler.
  if (ctx.message.text.trim().startsWith("/")) return next();

  const raw = ctx.message.text.trim().replace(/[$,\s]/g, "");
  const figure = parseFigure(raw, pending.mode);
  if (!figure) {
    // Keep the state so a typo can be retried instead of stranding the admin.
    await ctx.reply(
      pending.mode === "set"
        ? "That is not a valid balance. Send a whole number with no sign, for example 500 — or tap Cancel."
        : "That is not a valid change. Send a whole number with an optional sign, for example +500 or -200 — or tap Cancel.",
    );
    return;
  }

  const user = await findUserByTelegramId(pending.telegramId);
  if (!user) {
    awaitingAmount.delete(id);
    await ctx.reply(`⚠️ No account with Telegram ID ${escapeHtml(pending.telegramId)}. Nothing was changed.`);
    return;
  }

  const projected = project(user.balance, figure);
  if (projected < 0) {
    await ctx.reply(
      `⚠️ That change would take the balance below $0.\n\nCurrent balance: ${money(user.balance)}. Tap Cancel or send a smaller figure.`,
    );
    return;
  }
  // Two large credits in a row can land outside the column's own range, so refuse
  // here rather than letting Postgres raise a bare out-of-range error.
  if (projected > MAX_BALANCE) {
    await ctx.reply(
      `⚠️ That change would take the balance above ${money(MAX_BALANCE)}, the maximum this bot can hold.\n\nCurrent balance: ${money(user.balance)}.`,
    );
    return;
  }

  const result = await adjustBalance({
    telegramId: pending.telegramId,
    mode: figure.mode,
    value: figure.value,
    adminTelegramId: id,
  });
  if (!result) {
    awaitingAmount.delete(id);
    await ctx.reply(`⚠️ No account with Telegram ID ${escapeHtml(pending.telegramId)}. Nothing was changed.`);
    return;
  }

  awaitingAmount.delete(id);

  const lines = [
    `✅ Balance ${actionVerb(figure)} <b>${money(result.balance)}</b> for ${escapeHtml(displayName(user))}.`,
    `Previous balance: ${money(result.previous)}`,
  ];
  if (result.row) {
    const delta = result.row.amount ?? 0;
    lines.push("", `🧾 Ledger #${result.row.id} — ${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}`);
  }

  await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: detailKeyboard(pending.page, pending.telegramId),
  });

  // The member should not have to come back and refresh to notice the change.
  await pushBalanceAlert(pending.telegramId, result.balance - result.previous, result.previous, result.balance);
});

/**
 * Replaces the member's previous notice rather than adding to it, so a member
 * whose balance was touched five times still has exactly one live message. The
 * delete is best effort on purpose: the old notice may already be gone if the
 * member cleared the chat, and a failure there must not block the new one.
 */
async function pushBalanceAlert(telegramId: string, delta: number, previous: number, balance: number): Promise<void> {
  const stale = lastAlert.get(telegramId);
  if (stale !== undefined) {
    lastAlert.delete(telegramId);
    await bot.api
      .deleteMessage(telegramId, stale)
      .catch((err) => logger.debug({ err, telegramId, stale }, "previous balance notice already gone"));
  }

  const view = await buildDashboard(telegramId);
  try {
    const sent = await bot.api.sendMessage(
      telegramId,
      `${balanceAlert(delta, previous, balance)}\n\n${view.text}`,
      { reply_markup: view.keyboard, parse_mode: "HTML" },
    );
    lastAlert.set(telegramId, sent.message_id);
  } catch (err) {
    logger.warn({ err, telegramId }, "failed to push balance update to member");
  }
}

export { balanceAdmin };
