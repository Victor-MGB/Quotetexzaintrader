import { Composer, InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { adminIds } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { escapeHtml } from "../../shared/html.js";
import { isAdmin } from "../admin/store.js";

const support = new Composer<AppContext>();

const composing = new Map<string, boolean>();
const adminReply = new Map<string, { targetId: string; notifyMessageId?: number }>();

/**
 * Throws away a member's half-typed support message and any admin reply aimed at
 * them.
 *
 * Called when an admin deletes the account. A deleted member is off the whitelist,
 * so their next message would be refused by the gate before it reached the
 * composer — but the flag would sit in memory until the process restarted, and a
 * later re-registration under the same id would silently resume a conversation
 * that started before the account existed.
 */
export function forgetSupportState(telegramId: string): void {
  composing.delete(telegramId);
  adminReply.delete(telegramId);
}

/** Whether this member is part-way through typing a support message. */
export function isComposingSupport(telegramId: string): boolean {
  return composing.has(telegramId);
}

/** Marks this member as waiting to type a support message. */
export function beginSupport(telegramId: string): void {
  composing.set(telegramId, true);
}

const cancelKeyboard = () =>
  new InlineKeyboard().text("Cancel", "support:cancel").text("🏠 Main Menu", "main:menu");
const replyBackKeyboard = () =>
  new InlineKeyboard().text("💬 Reply Back", "support:start").text("🏠 Main Menu", "main:menu");

support.callbackQuery("support:cancel", async (ctx) => {
  const id = String(ctx.from?.id ?? 0);
  composing.delete(id);
  adminReply.delete(id);
  await ctx.answerCallbackQuery("Cancelled");
  await ctx.editMessageText("Cancelled.");
});

support.callbackQuery("support:start", async (ctx) => {
  const id = String(ctx.from?.id ?? 0);
  beginSupport(id);
  const from = ctx.from;
  const name = from?.username ? `@${from.username}` : from?.first_name ?? "you";
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `✍️ Support, ${name}!\n\nType your message below — describe your issue or question. The admin will reply right here in this chat.`,
    { reply_markup: cancelKeyboard() },
  );
});

support.callbackQuery(/^support:reply_(\d+)$/, async (ctx) => {
  const adminId = String(ctx.from?.id ?? 0);
  if (!isAdmin(adminId)) return;

  const targetId = ctx.match[1];
  if (!targetId) return;

  adminReply.set(adminId, {
    targetId,
    notifyMessageId: ctx.callbackQuery.message?.message_id,
  });
  await ctx.answerCallbackQuery();
  await ctx.reply("✍️ Type your reply to the user. It will be sent to them immediately.", {
    reply_markup: cancelKeyboard(),
  });
});

support.on("message:text", async (ctx, next) => {
  const id = String(ctx.from?.id ?? 0);
  const from = ctx.from;

  const reply = adminReply.get(id);
  if (reply) {
    adminReply.delete(id);
    const text = ctx.message.text;
    await ctx.api
      .sendMessage(Number(reply.targetId), `📨 <b>Reply from Support</b>\n\n${escapeHtml(text)}`, {
        reply_markup: replyBackKeyboard(),
        parse_mode: "HTML",
      })
      .catch((err) => logger.warn({ err }, "failed to forward support reply"));
    if (reply.notifyMessageId) {
      await ctx.api
        .editMessageText(ctx.chat.id, reply.notifyMessageId, "✅ Reply sent to the user.")
        .catch(() => undefined);
    }
    await ctx.reply("✅ Reply sent.");
    return;
  }

  if (composing.has(id)) {
    composing.delete(id);
    const text = ctx.message.text;
    const name = from?.username ? `@${from.username}` : from?.first_name ?? "unknown";

    const keyboard = new InlineKeyboard().text("✍️ Reply", `support:reply_${id}`);
    const body = `📨 <b>Support message</b>\n\n👤 ${name}\n🆔 <code>${id}</code>\n💬 ${escapeHtml(text)}`;

    for (const adminId of adminIds) {
      await ctx.api
        .sendMessage(adminId, body, { reply_markup: keyboard, parse_mode: "HTML" })
        .catch((err) => logger.warn({ err, adminId }, "failed to notify admin of support message"));
    }

    await ctx.reply("✅ Your message has been sent to support. You'll get a reply here soon.");
    return;
  }

  return next();
});

export { support };