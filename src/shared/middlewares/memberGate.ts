import type { NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { isAdmin } from "../../modules/admin/store.js";
import { requireSession } from "../requireSession.js";

/**
 * Puts the whole member side of the bot behind a live login.
 *
 * The per-handler `requireSession` calls were never enough: the main menu, the
 * testimony feed, the promo screens and every command answered an anonymous
 * member, so a bot that could expire a session still let the same person walk
 * straight back in. This runs once, ahead of all of them, so "log in to use the
 * bot" is a property of the bot rather than something each screen remembers to
 * check.
 *
 * It sits after the auth composer, so registering, logging in and the password
 * prompt itself are never caught by it — a member answering a password question
 * has no session yet, by definition. It also refreshes the inactivity clock on
 * every update, so browsing the menu keeps a session alive the way activity on
 * a website does.
 */
export async function memberGate(ctx: AppContext, next: NextFunction): Promise<void> {
  if (!ctx.from) return next();
  if (isAdmin(String(ctx.from.id))) return next();

  if (!(await requireSession(ctx))) return;
  await next();
}
