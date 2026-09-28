import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { bot } from "../../core/bot.js";
import { adminIds } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { describeDeposit, describeDepositStatus, envAddress, setSetting } from "../../core/settings.js";
import { escapeHtml } from "../../shared/html.js";
import { logout } from "../auth/session.js";
import { listUsers, type UserRow } from "../auth/users.js";
import { WALLETS, sanitizeAddress, walletByKey } from "../main/content.js";
import { grandTotals, referrerLeaderboard, type ReferrerRow } from "../referrals/store.js";
import { refreshMenu } from "../menu.js";
import { userButton } from "./balance.js";
import { isLocked } from "./store.js";
import { allowUser, disallowUser, isAdmin, isAllowed, isPermanentAdmin, listAllowed, setLock } from "./store.js";
import { purgeMember } from "./purge.js";
import {
  countPendingRequests,
  decideAccess,
  listPendingRequests,
  requestAccess,
  type AccessRequestRow,
} from "./requests.js";
import type { AccessRequestStatus } from "../../db/schema.js";

const admin = new Composer<AppContext>();

// How often the same blocked member may be told their request is waiting, so a
// member tapping Start repeatedly does not fill their own chat with it.
const REPLY_COOLDOWN_MS = 15_000;
const replied = new Map<string, number>();

export async function adminGate(ctx: AppContext, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) return next();

  await refreshMenu(from);

  const id = String(from.id);

  if (isAdmin(id)) return next();

  // A locked bot is a temporary pause, not a verdict on this member, so nobody
  // is put up for approval while it is locked. Asking for access here would
  // queue every member of the bot the moment an admin pressed /lock.
  if (isLocked()) {
    if (await shouldReply(id)) {
      await ctx.reply(
        `🔒 The bot is locked by an admin right now.\n\nNothing you tap will do anything until it is unlocked. Try again shortly.`,
      );
    }
    return;
  }

  if (isAllowed(id)) return next();

  // Someone with no access is a request to be reviewed, not a dead end. The
  // request is recorded against their telegram id and the admins are told, which
  // is the same path a brand new member takes when they tap Start.
  const outcome = await requestAccess({
    telegramId: id,
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  }).catch((err) => {
    logger.error({ err, telegramId: id }, "failed to record access request (non-fatal)");
    return null;
  });

  if (outcome?.notify) await notifyAdminsOfRequest(outcome.row);

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery(outcome ? "Waiting for the admin" : "Access restricted").catch(() => undefined);
  }

  if (await shouldReply(id)) await ctx.reply(requestPendingText(outcome?.previous ?? null, id));
}

/** Rate limits the bot's own replies to one member, so a tap-spammer is not buried. */
async function shouldReply(id: string): Promise<boolean> {
  const now = Date.now();
  if ((replied.get(id) ?? 0) + REPLY_COOLDOWN_MS > now) return false;
  replied.set(id, now);
  return true;
}

/** What the member reads while waiting. The history of the request decides the tone. */
function requestPendingText(previous: AccessRequestStatus | null, id: string): string {
  const header = `⏳ Your access request is with the admin.

🆔 Your Telegram ID: ${id}

You will be notified here the moment it is approved or rejected. Once you are approved you can create an account and log in — nothing in the bot opens before that.`;

  if (previous === "rejected") {
    return `🔁 Your earlier request was rejected, so this is a fresh one.

${header}`;
  }

  if (previous === "approved") {
    return `🔁 Your access was withdrawn, so this is a new request.

${header}`;
  }

  return header;
}

function requesterName(row: AccessRequestRow): string {
  if (row.username) return `@${row.username}`;
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || "unknown";
}

async function notifyAdminsOfRequest(row: AccessRequestRow): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("✅ Approve", `admin:allow_${row.telegramId}`)
    .text("⛔ Reject", `admin:reject_${row.telegramId}`);

  const name = requesterName(row);
  const text =
    `🆕 <b>New access request</b>\n\n` +
    `${escapeHtml(name)}\n🆔 <code>${row.telegramId}</code>\n\n` +
    `Approve to let them into the bot, or reject to turn them away. Either way they are told which it was.`;

  for (const adminId of adminIds) {
    await bot.api
      .sendMessage(adminId, text, { reply_markup: keyboard, parse_mode: "HTML" })
      .catch((err) => logger.warn({ err, adminId }, "failed to notify admin of an access request"));
  }
}

const decisionKeyboard = () =>
  new InlineKeyboard()
    .text("📝 Register / Create Account", "plans:register")
    .text("🔑 Login", "plans:login");

/**
 * Grants access and tells the member. Returns false when the request had already
 * been decided, which is how a double tap is kept from messaging the member
 * twice.
 */
async function approveAccess(telegramId: string, byId: string): Promise<boolean> {
  await allowUser(telegramId);
  const decided = await decideAccess(telegramId, "approved", byId);
  replied.delete(telegramId);

  await bot.api
    .sendMessage(
      telegramId,
      `✅ <b>Your access request has been approved.</b>\n\n` +
        `You can now create your account and start using the bot.`,
      { reply_markup: decisionKeyboard(), parse_mode: "HTML" },
    )
    .catch((err) => logger.warn({ err, telegramId }, "failed to tell member they were approved"));

  return decided !== null;
}

/** Turns the member away, tells them, and leaves the decision on the record. */
async function rejectAccess(telegramId: string, byId: string): Promise<boolean> {
  await disallowUser(telegramId);
  const decided = await decideAccess(telegramId, "rejected", byId);
  replied.delete(telegramId);
  // A member who was let in and then rejected must not keep a live session.
  logout(telegramId);

  await bot.api
    .sendMessage(
      telegramId,
      `⛔ <b>Your access request was rejected.</b>\n\n` +
        `You cannot use the bot right now. If you think this is a mistake, send /start to ask again.`,
    )
    .catch((err) => logger.warn({ err, telegramId }, "failed to tell member they were rejected"));

  return decided !== null;
}

function idFromArgs(ctx: AppContext): string | null {
  const text = typeof ctx.match === "string" ? ctx.match.trim() : "";
  return text && /^\d+$/.test(text) ? text : null;
}

admin.callbackQuery(/^admin:allow_(\d+)$/, async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = ctx.match[1];
  if (!id) return;

  const fresh = await approveAccess(id, String(ctx.from?.id ?? 0));
  await ctx.answerCallbackQuery(fresh ? "Approved" : "Already decided");
  await ctx.editMessageText(
    fresh ? `✅ User ${id} is now allowed and has been told.` : `ℹ️ The request for ${id} was already decided.`,
  );
});

admin.callbackQuery(/^admin:reject_(\d+)$/, async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = ctx.match[1];
  if (!id) return;

  const fresh = await rejectAccess(id, String(ctx.from?.id ?? 0));
  await ctx.answerCallbackQuery(fresh ? "Rejected" : "Already decided");
  await ctx.editMessageText(
    fresh ? `⛔ User ${id} was rejected and has been told.` : `ℹ️ The request for ${id} was already decided.`,
  );
});

const REQUESTS_PER_PAGE = 8;

async function requestsPage(
  page: number,
): Promise<{ text: string; markup: InlineKeyboard | undefined }> {
  const rows = await listPendingRequests(200);
  const pages = Math.max(1, Math.ceil(rows.length / REQUESTS_PER_PAGE));
  const target = Math.min(Math.max(page, 0), pages - 1);
  const slice = rows.slice(target * REQUESTS_PER_PAGE, (target + 1) * REQUESTS_PER_PAGE);

  const text =
    `🆕 <b>Access requests</b> — ${await countPendingRequests()} waiting · page ${target + 1}/${pages}\n\n` +
    (slice.length
      ? slice
          .map(
            (row) =>
              `<b>${escapeHtml(requesterName(row))}</b> · asked ${row.requestedAt.toISOString().slice(0, 16).replace("T", " ")}\n` +
              `   🆔 <code>${escapeHtml(row.telegramId)}</code>`,
          )
          .join("\n\n")
      : "No one is waiting. New requests appear here the moment somebody taps Start.");

  const kb = new InlineKeyboard();
  slice.forEach((row, i) => {
    if (i > 0) kb.row();
    kb.text(`✅ ${row.telegramId}`, `admin:allow_${row.telegramId}`);
    kb.text(`⛔ ${row.telegramId}`, `admin:reject_${row.telegramId}`);
  });
  if (slice.length && (target > 0 || target < pages - 1)) kb.row();
  if (target > 0) kb.text("⬅ Prev", `admin:reqs_${target - 1}`);
  if (target < pages - 1) kb.text("Next ➡", `admin:reqs_${target + 1}`);

  return { text, markup: kb.inline_keyboard.length ? kb : undefined };
}

admin.command("pending", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const view = await requestsPage(0);
  await ctx.reply(view.text, { reply_markup: view.markup, parse_mode: "HTML" });
});

admin.callbackQuery(/^admin:reqs_(\d+)$/, async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const page = Number(ctx.match[1] ?? 0);
  await ctx.answerCallbackQuery();
  const view = await requestsPage(page);
  await ctx.editMessageText(view.text, { reply_markup: view.markup, parse_mode: "HTML" });
});

admin.command("allow", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = idFromArgs(ctx);
  if (!id) {
    await ctx.reply("Usage: /allow <telegram-id>");
    return;
  }
  const fresh = await approveAccess(id, String(ctx.from?.id ?? 0));
  await ctx.reply(fresh ? `✅ User ${id} is now allowed and has been told.` : `ℹ️ The request for ${id} was already decided.`);
});

admin.command("reject", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = idFromArgs(ctx);
  if (!id) {
    await ctx.reply("Usage: /reject <telegram-id>");
    return;
  }
  const fresh = await rejectAccess(id, String(ctx.from?.id ?? 0));
  await ctx.reply(fresh ? `⛔ User ${id} was rejected and has been told.` : `ℹ️ The request for ${id} was already decided.`);
});

admin.command("disallow", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;
  const id = idFromArgs(ctx);
  if (!id) {
    await ctx.reply("Usage: /disallow <telegram-id>");
    return;
  }
  await disallowUser(id);
  logout(id);
  replied.delete(id);
  await ctx.reply(`User ${id} is no longer allowed. Their session has been ended too.`);
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

function usersPage(all: UserRow[], page: number): { text: string; markup: InlineKeyboard | undefined } {
  const pages = Math.max(1, Math.ceil(all.length / USERS_PER_PAGE));
  const start = page * USERS_PER_PAGE;
  const slice = all.slice(start, start + USERS_PER_PAGE);
  const text =
    `👥 <b>Registered users</b> — ${all.length} total · page ${page + 1}/${pages}\n\n` +
    slice.map(userEntry).join("\n");

  const kb = new InlineKeyboard();
  // One tappable row per member so an admin can open a client and edit their balance.
  // row() before the first button would emit an empty row, so it only breaks between.
  slice.forEach((user, i) => {
    if (i > 0) kb.row();
    const button = userButton(user, page);
    kb.text(button.text, button.data);
  });
  // Keep pagination on its own row, but never leave a trailing empty one.
  if (slice.length && (page > 0 || page < pages - 1)) kb.row();
  if (page > 0) kb.text("⬅ Prev", `admin:users_${page - 1}`);
  if (page < pages - 1) kb.text("Next ➡", `admin:users_${page + 1}`);
  return { text, markup: kb.inline_keyboard.length ? kb : undefined };
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

const REFERRERS_PER_PAGE = 8;

/** Resolve a referrer to their registered handle, falling back to the raw id. */
function memberName(telegramId: string, known: Map<string, string>): string {
  return known.get(telegramId) ?? `id ${telegramId}`;
}

/** Aggregates arrive as "YYYY-MM-DD hh:mm:ss"; take the day without timezone maths. */
function formatDay(value: string | Date | null): string {
  if (!value) return "—";
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function referrerEntry(row: ReferrerRow, known: Map<string, string>): string {
  const name = memberName(row.referrerId, known);
  const last = formatDay(row.lastJoinedAt);
  return `<b>${escapeHtml(name)}</b> · 👥 ${row.joined} · 🎁 ${row.qualified} · ✅ ${row.paid}
   🆔 <code>${escapeHtml(row.referrerId)}</code> · last ${last}`;
}

async function referralsPage(page: number): Promise<{ text: string; markup: InlineKeyboard | undefined }> {
  const [rows, totals, members] = await Promise.all([referrerLeaderboard(), grandTotals(), listUsers()]);
  const known = new Map(members.map((u) => [u.telegramId, u.username ? `@${u.username}` : (u.firstName ?? u.telegramId)]));

  const pages = Math.max(1, Math.ceil(rows.length / REFERRERS_PER_PAGE));
  const target = Math.min(Math.max(page, 0), pages - 1);
  const start = target * REFERRERS_PER_PAGE;

  const text =
    `🔗 <b>Referrals</b> — ${rows.length} referrers · ${totals.joined} joined · ${totals.qualified} qualified · ${totals.paid} paid\n` +
    `page ${target + 1}/${pages}\n\n` +
    (rows.length
      ? rows.slice(start, start + REFERRERS_PER_PAGE).map((row) => referrerEntry(row, known)).join("\n\n")
      : "No referrals recorded yet. Members build a link from Promo Plan → Referral Bonus.");

  const kb = new InlineKeyboard();
  if (target > 0) kb.text("⬅ Prev", `admin:referrals_${target - 1}`);
  if (target < pages - 1) kb.text("Next ➡", `admin:referrals_${target + 1}`);
  // Telegram rejects an inline_keyboard with no rows, so omit the markup entirely.
  return { text, markup: kb.inline_keyboard.length ? kb : undefined };
}

admin.command("referrals", async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;

  const view = await referralsPage(0);
  await ctx.reply(view.text, { reply_markup: view.markup, parse_mode: "HTML" });
});

admin.callbackQuery(/^admin:referrals_(\d+)$/, async (ctx) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return;

  const page = Number(ctx.match[1] ?? 0);
  await ctx.answerCallbackQuery();
  const view = await referralsPage(page);
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

  // Only ADMIN_IDS can survive a delete, because it is environment config rather
  // than a row, so that is the one case worth stopping for. A runtime promotion is
  // demoted as part of the delete.
  const purged = await purgeMember(id);
  if (!purged) {
    await ctx.reply(
      isPermanentAdmin(id)
        ? `⚠️ ${id} is a permanent admin in ADMIN_IDS. Remove them from the environment first, then run this again.`
        : `Nothing at all is recorded for ${id}. No account, no transactions, no referrals, no testimonies and no pending request — so there was nothing to delete.`,
    );
    return;
  }

  const who = purged.user
    ? `#${purged.user.id} (${purged.user.username ? `@${purged.user.username}` : purged.user.firstName ?? "no name"}${purged.user.email ? ` · ${purged.user.email}` : ""})`
    : `${id} had no account row left, so the remaining rows are what was cleared`;

  await ctx.reply(
    `🗑 Deleted ${who}.

Also removed: ${purged.transactions} transaction(s), ${purged.referrals} referral record(s), ${purged.testimonies} testimonies, ${purged.accessRequests} access request(s), ${purged.whitelist} access grant(s) and ${purged.adminPromotions} admin promotion(s).

Their bot access and login session are gone too, so every button they tap now asks them for access, and an admin has to approve them again before anything opens. They have been told.`,
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