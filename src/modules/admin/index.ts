import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { bot } from "../../core/bot.js";
import { adminIds } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { describeDeposit, describeDepositStatus, envAddress, setSetting } from "../../core/settings.js";
import { escapeHtml } from "../../shared/html.js";
import { deleteUser, findUserByTelegramId, listUsers, type UserRow } from "../auth/users.js";
import { WALLETS, sanitizeAddress, walletByKey } from "../main/content.js";
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

const USERS_PER_PAGE = 8;

function userEntry(user: UserRow): string {
  const name = user.username ? `@${user.username}` : user.firstName ?? "no name";
  const joined = user.createdAt.toISOString().slice(0, 10);
  const email = user.email ? ` · ${escapeHtml(user.email)}` : "";
  return `#${user.id} · <b>${escapeHtml(name)}</b> · $${user.balance} · ${joined}
   🆔 <code>${user.telegramId}</code>${email}`;
}

function usersPage(all: UserRow[], page: number): { text: string; markup: InlineKeyboard } {
  const pages = Math.max(1, Math.ceil(all.length / USERS_PER_PAGE));
  const start = page * USERS_PER_PAGE;
  const text =
    `👥 <b>Registered users</b> — ${all.length} total · page ${page + 1}/${pages}\n\n` +
    all.slice(start, start + USERS_PER_PAGE).map(userEntry).join("\n");

  const kb = new InlineKeyboard();
  if (page > 0) kb.text("⬅ Prev", `admin:users_${page - 1}`);
  if (page < pages - 1) kb.text("Next ➡", `admin:users_${page + 1}`);
  return { text, markup: kb };
}

admin.command("users", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;

  const all = await listUsers();
  if (!all.length) {
    await ctx.reply("No registered users yet.");
    return;
  }

  const page = usersPage(all, 0);
  await ctx.reply(page.text, { reply_markup: page.markup, parse_mode: "HTML" });
});

admin.callbackQuery(/^admin:users_(\d+)$/, async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;

  const all = await listUsers();
  const page = Number(ctx.match[1] ?? 0);
  const last = Math.max(0, Math.ceil(all.length / USERS_PER_PAGE) - 1);
  const target = Math.min(Math.max(page, 0), last);

  await ctx.answerCallbackQuery();
  const view = usersPage(all, target);
  await ctx.editMessageText(view.text, { reply_markup: view.markup, parse_mode: "HTML" });
});

admin.command("deleteuser", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;

  const self = String(ctx.from?.id ?? 0);
  const id = idFromArgs(ctx);
  if (!id) {
    await ctx.reply("Usage: /deleteuser <telegram-id>");
    return;
  }
  if (id === self) {
    await ctx.reply("You cannot delete your own account.");
    return;
  }

  const target = await findUserByTelegramId(id);
  if (!target) {
    await ctx.reply(`No account with Telegram ID ${id}.`);
    return;
  }

  await deleteUser(id);
  await disallowUser(id);

  await ctx.reply(
    `🗑 Deleted account #${target.id} (${target.username ? `@${target.username}` : target.firstName ?? "no name"}${target.email ? ` · ${target.email}` : ""}).\n\nBot access removed as well.`,
  );
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

function argsOf(ctx: AppContext): string[] {
  const text = typeof ctx.match === "string" ? ctx.match.trim() : "";
  return text ? text.split(/\s+/) : [];
}

admin.command("setaddress", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;

  const [key, ...rest] = argsOf(ctx);
  const address = rest.join(" ").trim();

  if (!key || !address) {
    await ctx.reply(`Usage: /setaddress <${WALLETS.map((w) => w.key).join("|")}> <address>`);
    return;
  }

  const wallet = walletByKey(key);
  if (!wallet) {
    await ctx.reply(`Unknown method "${key}". Use one of: ${WALLETS.map((w) => w.key).join(", ")}`);
    return;
  }

  if (!sanitizeAddress(wallet, address)) {
    await ctx.reply(`"${address}" is not a valid ${wallet.asset} address for ${wallet.network}. Nothing was saved.`);
    return;
  }

  await setSetting(wallet.settingKey, address);
  const override = envAddress(wallet)
    ? `\n\n⚠️ ${wallet.envKey} is set in the environment and takes priority, so members will still see that address.`
    : "";
  await ctx.reply(`✅ ${wallet.asset} (${wallet.label}) deposit address saved.${override}`);
});

admin.command("addresses", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;

  const lines = await Promise.all(WALLETS.map(async (w) => describeDepositStatus(await describeDeposit(w))));
  await ctx.reply(`Deposit addresses:\n\n${lines.join("\n")}`);
});

export { admin };