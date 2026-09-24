import { Composer, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { isAdmin, isAllowed, allowUser, disallowUser, listAllowed, setLock, isLocked } from "./store.js";

const admin = new Composer<AppContext>();

const NOTIFY_COOLDOWN_MS = 15_000;
const notified = new Map<string, number>();

export async function adminGate(ctx: AppContext, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) return next();

  const id = String(from.id);

  if (isAdmin(id)) return next();
  if (isAllowed(id)) return next();

  const now = Date.now();
  if ((notified.get(id) ?? 0) + NOTIFY_COOLDOWN_MS <= now) {
    notified.set(id, now);
    await ctx.reply(
      `Access restricted. This bot is only for approved users.\n\nYour Telegram ID: ${id}\n\nContact the admin to get access.`,
    );
  }
}

function idFromArgs(ctx: AppContext): string | null {
  const text = typeof ctx.match === "string" ? ctx.match.trim() : "";
  return text && /^\d+$/.test(text) ? text : null;
}

admin.command("allow", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = idFromArgs(ctx);
  if (!id) {
    await ctx.reply("Usage: /allow <telegram-id>");
    return;
  }
  await allowUser(id);
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