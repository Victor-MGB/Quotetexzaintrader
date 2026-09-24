import { Composer, InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { adminIds } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { isAdmin } from "../admin/store.js";

const support = new Composer<AppContext>();

const composing = new Map<string, boolean>();
const adminReply = new Map<string, { targetId: string; notifyMessageId?: number }>();

const cancelKeyboard = () =>
  new InlineKeyboard().text("Cancel", "support:cancel");
const replyBackKeyboard = () =>
  new InlineKeyboard().text("💬 Reply Back", "support:start");

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

support.callbackQuery("support:cancel", async (ctx) => {
  const id = String(ctx.from?.id ?? 0);
  composing.delete(id);
  adminReply.delete(id);
  await ctx.answerCallbackQuery("Cancelled");
  await ctx.editMessageText("Cancelled.");
});

support.callbackQuery("support:start", async (ctx) => {
  const id = String(ctx.from?.id ?? 0);
  composing.set(id, true);
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