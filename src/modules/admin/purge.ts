import { bot } from "../../core/bot.js";
import { logger } from "../../core/logger.js";
import { registerKeyboard } from "../auth/index.js";
import { logout } from "../auth/session.js";
import { clearFlow } from "../auth/state.js";
import { deleteUser, type PurgeResult } from "../auth/users.js";
import { invalidateMenu } from "../menu.js";
import { forgetComposing } from "../main/index.js";
import { forgetDraft } from "../testimony/index.js";
import { forgetAccess, isAdmin } from "./store.js";

export interface PurgeOptions {
  /** Set false to delete silently, e.g. when a script is doing the cleanup. */
  notify?: boolean;
}

/**
 * Deletes a member: the database rows and everything this process remembers
 * about them.
 *
 * The two halves have to happen together. Removing the rows alone leaves the
 * login session, the menu, the cached whitelisting and any half-typed withdrawal
 * in memory, which is exactly how a deleted member kept working for half an hour
 * after an admin believed they were gone. And the member is told, because the
 * alternative is a person tapping buttons wondering why a bot that knows their
 * name has forgotten they exist.
 */
export async function purgeMember(telegramId: string, opts: PurgeOptions = {}): Promise<PurgeResult | null> {
  // An admin's access comes from ADMIN_IDS or the admins table, not from the
  // users table, so deleting their account would leave them a logged-in admin
  // with no account behind it. Demote first, then delete, if that is what you
  // want.
  if (isAdmin(telegramId)) {
    logger.warn({ telegramId }, "refused to delete an admin account");
    return null;
  }

  const result = await deleteUser(telegramId);
  if (!result) return null;

  logout(telegramId);
  clearFlow(telegramId);
  forgetAccess(telegramId);
  forgetComposing(telegramId);
  forgetDraft(telegramId);
  invalidateMenu(Number(telegramId));

  logger.info(
    {
      telegramId,
      userId: result.user.id,
      transactions: result.transactions,
      referrals: result.referrals,
      testimonies: result.testimonies,
    },
    "member purged",
  );

  if (opts.notify !== false) await notifyDeleted(telegramId);

  return result;
}

async function notifyDeleted(telegramId: string): Promise<void> {
  await bot.api
    .sendMessage(
      telegramId,
      `🗑 Your account has been deleted by an admin.

Everything tied to it — balance, transactions, referrals and testimonies — has
been removed. You can create a new account below if you still need access; an
admin will have to approve it again.`,
      { reply_markup: registerKeyboard },
    )
    .catch((err) => logger.warn({ err, telegramId }, "failed to tell member their account was deleted"));
}
