import { bot } from "../../core/bot.js";
import { logger } from "../../core/logger.js";
import { logout } from "../auth/session.js";
import { clearFlow } from "../auth/state.js";
import { deleteUser, type PurgeResult } from "../auth/users.js";
import { invalidateMenu } from "../menu.js";
import { forgetComposing } from "../main/index.js";
import { forgetReferralNote } from "../referrals/index.js";
import { forgetSupportState } from "../support/index.js";
import { forgetDraft } from "../testimony/index.js";
import { demoteAdmin, forgetAccess, isAdmin, isPermanentAdmin } from "./store.js";

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
 * in memory, which is exactly how a deleted member kept working after an admin
 * believed they were gone. And the member is told, because the alternative is a
 * person tapping buttons wondering why a bot that knows their name has forgotten
 * they exist.
 */
export async function purgeMember(telegramId: string, opts: PurgeOptions = {}): Promise<PurgeResult | null> {
  // ADMIN_IDS is the one source of access that deleting rows cannot take away, so
  // refusing those is the only real safety rail here: a permanent admin is a
  // decision somebody made in the environment, not a row a mis-click should undo.
  if (isPermanentAdmin(telegramId)) {
    logger.warn({ telegramId }, "refused to delete a permanent ADMIN_IDS account");
    return null;
  }

  // A runtime promotion is not a safety rail, it is a row. The live `admins` set
  // is the in-memory twin of that row, and it is checked ahead of the account
  // lookup by both `isAdmin` and `accessVerdict` — so a promoted member with no
  // account was untouchable: the delete refused because they were an admin, and
  // the admin check granted them every screen in the bot. That is the combination
  // that left a deleted person still an admin. Demoting first is what makes
  // "delete this person" mean the person.
  if (isAdmin(telegramId)) {
    await demoteAdmin(telegramId);
    logger.info({ telegramId }, "demoted a promoted admin so the account could be purged");
  }

  // The sweep is keyed on the telegram id, not on the account row, so an admin
  // who repeats a delete finishes the job rather than being told there is nothing
  // there while the leftover transactions and request are still in place.
  const result = await deleteUser(telegramId);
  if (!result) return null;

  logout(telegramId);
  clearFlow(telegramId);
  forgetAccess(telegramId);
  forgetComposing(telegramId);
  forgetDraft(telegramId);
  forgetSupportState(telegramId);
  forgetReferralNote(telegramId);
  invalidateMenu(Number(telegramId));

  logger.info(
    {
      telegramId,
      userId: result.user?.id ?? null,
      hadAccount: result.hadAccount,
      transactions: result.transactions,
      referrals: result.referrals,
      testimonies: result.testimonies,
      accessRequests: result.accessRequests,
    },
    "member purged",
  );

  if (opts.notify !== false) await notifyDeleted(telegramId, result);

  return result;
}

/**
 * What the deleted member is told, and the one thing they can do about it.
 *
 * There is deliberately no button on this message. A deleted member is off the
 * whitelist, so the gate refuses every callback a button here would send, and a
 * button that answers with a refusal is a worse experience than being told the
 * one route that works. /start is that route: it queues a fresh request with the
 * admins, exactly the path a brand new Telegram user takes, and an approval there
 * is what puts them back inside.
 */
async function notifyDeleted(telegramId: string, result: PurgeResult): Promise<void> {
  const headline = result.hadAccount
    ? "🗑 Your account has been deleted by an admin."
    : "🗑 Your account is already gone. An admin has finished clearing out what was left of it.";

  await bot.api
    .sendMessage(
      telegramId,
      `${headline}

Everything tied to it — balance, transactions, referrals and testimonies — has been
removed, along with your access to the bot and your login session. Nothing you tap
will work until an admin approves you again.

Send /start to ask for access, and they will be notified.`,
      { link_preview_options: { is_disabled: true } },
    )
    .catch((err) => logger.warn({ err, telegramId }, "failed to tell member their account was deleted"));
}
