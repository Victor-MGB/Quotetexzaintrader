import type { NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { logger } from "../../core/logger.js";
import { parseReferralPayload, recordReferral } from "./store.js";

export { referralLink, referralScreen, shareUrl, botUsername, REFERRAL_REWARD } from "./screen.js";
export { parseReferralPayload, recordReferral } from "./store.js";

const NOTE_JOINED = "\n\n👥 You joined through a referral link.";
const NOTE_EXISTING = "\n\n👥 This account was already referred, so the original referrer is kept.";

// Held only between the capture middleware and the /start handler. Same pattern as the
// composing map in the main module: a single value per user, read once then dropped.
const notes = new Map<string, string>();

/** grammy hands the /start argument to ctx.match, which a plain middleware does not have. */
function payloadFromText(text: string | undefined): string | undefined {
  const match = /^\/start(?:@\S+)?(?:\s+(\S+))?$/.exec(text?.trim() ?? "");
  return match?.[1];
}

/**
 * Must run before adminGate: a referral invitee is by definition not yet on the
 * whitelist, so attributing inside the /start handler would never be reached.
 * Registered after rateLimit so a flood of deep links cannot hammer the database.
 */
export async function referralCapture(ctx: AppContext, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (from) {
    const inviteeId = String(from.id);
    const referrerId = parseReferralPayload(payloadFromText(ctx.msg?.text));

    if (referrerId && referrerId !== inviteeId) {
      try {
        const saved = await recordReferral(referrerId, inviteeId);
        notes.set(inviteeId, saved ? NOTE_JOINED : NOTE_EXISTING);
        logger.info({ referrerId, inviteeId, recorded: Boolean(saved) }, "referral captured");
      } catch (err) {
        logger.warn({ err }, "failed to record referral (non-fatal)");
      }
    } else if (referrerId) {
      logger.warn({ telegramId: inviteeId }, "ignored self-referral payload");
    }
  }

  await next();
}

/** Read-and-clear the note so a later /start does not repeat it. */
export function consumeReferralNote(telegramId: string): string {
  const note = notes.get(telegramId) ?? "";
  notes.delete(telegramId);
  return note;
}
