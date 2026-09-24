import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { bot } from "../../core/bot.js";
import { adminIds } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { refreshMenu } from "../menu.js";
import { isLocked } from "./store.js";
import { allowUser, disallowUser, isAdmin, isAllowed, listAllowed, setLock } from "./store.js";

const admin = new Composer<AppContext>();

const NOTIFY_COOLDOWN_MS = 15_000;
const notified = new Map<string, number>();
const adminNotified = new Set<string>();

export async function adminGate(ctx: AppContext, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) return next();

  await refreshMenu(from);

  const id = String(from.id);

  if (isAdmin(id) || isAllowed(id)) return next();

  const now = Date.now();
  if ((notified.get(id) ?? 0) + NOTIFY_COOLDOWN_MS <= now) {
    notified.set(id, now);
    await ctx.reply(
      `Access restricted. This bot is only for approved users.\n\nYour Telegram ID: ${id}\n\nContact the admin to get access.`,
    );
  }

  if (!adminNotified.has(id)) {
    adminNotified.add(id);
    await notifyAdmin(from);
  }
}

async function notifyAdmin(from: AppContext["from"]): Promise<void> {
  const id = String(from?.id ?? "");
  const name = from?.username ? `@${from.username}` : from?.first_name ?? "unknown";

  const keyboard = new InlineKeyboard()
    .text("Approve", `admin:allow_${id}`)
    .text("Dismiss", `admin:dismiss_${id}`);

  const text = `❌ Unapproved user tried to use the bot.\n\n${name}\nID: ${id}`;

  for (const adminId of adminIds) {
    await bot.api
      .sendMessage(adminId, text, { reply_markup: keyboard })
      .catch((err) => logger.warn({ err, adminId }, "failed to notify admin"));
  }
}

function idFromArgs(ctx: AppContext): string | null {
  const text = typeof ctx.match === "string" ? ctx.match.trim() : "";
  return text && /^\d+$/.test(text) ? text : null;
}

admin.callbackQuery(/^admin:allow_(\d+)$/, async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = ctx.match[1];
  if (!id) return;
  await allowUser(id);
  adminNotified.delete(id);
  await ctx.answerCallbackQuery("Approved");
  await ctx.editMessageText(`✅ User ${id} is now allowed.`);
});

admin.callbackQuery(/^admin:dismiss_(\d+)$/, async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  await ctx.answerCallbackQuery("Dismissed");
  await ctx.editMessageText(`Notification cleared.`);
});

admin.command("allow", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = idFromArgs(ctx);
  if (!id) {
    await ctx.reply("Usage: /allow <telegram-id>");
    return;
  }
  await allowUser(id);
  adminNotified.delete(id);
  await ctx.reply(`User ${id} is now allowed.`);
});

admin.command("disallow", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = idFromArgs(ctx);
  if (!id) {
    await ctx.reply("Usage: /disallow <telegram-id>");
    return;
  }
  await disallowUser(id);
  await ctx.reply(`User ${id} is no longer allowed.`);
});

admin.command("list", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const ids = await listAllowed();
  const text = ids.length ? ids.join("\n") : "No allowed users yet.";
  await ctx.reply(`Allowed users:\n${text}`);
});

admin.command("lock", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  await setLock(true);
  await ctx.reply("Bot locked. Buttons hidden from all non-admins.");
});

admin.command("unlock", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  await setLock(false);
  await ctx.reply("Bot unlocked. Approved users have access.");
});

admin.command("status", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  await ctx.reply(`Locked: ${isLocked() ? "yes" : "no"}\nApproved users: ${(await listAllowed()).length}`);
});

export { admin };