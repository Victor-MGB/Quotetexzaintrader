import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../core/db.js";
import { accessRequests, type AccessRequestStatus } from "../../db/schema.js";

export type AccessRequestRow = typeof accessRequests.$inferSelect;

/**
 * How long a member has to wait before the admins are told about them again.
 *
 * Without this, every button a blocked member taps writes a fresh notification to
 * every admin, and a single confused person produces a wall of identical pings.
 * Six hours is long enough that a genuine second attempt still gets through.
 */
export const NOTIFY_COOLDOWN_MS = 6 * 60 * 60_000;

export interface AccessRequester {
  telegramId: string;
  username?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
}

export interface AccessOutcome {
  row: AccessRequestRow;
  /** True when the admins have not been told about this request recently. */
  notify: boolean;
  /** True the very first time this person asked for access. */
  firstTime: boolean;
  /** What the request looked like before this call, or null if it is new. */
  previous: AccessRequestStatus | null;
}

/**
 * Records that someone wants access, and says whether the admins need telling.
 *
 * The row is keyed by telegram id, so a member who taps Start repeatedly updates
 * one request rather than creating a queue of identical ones. A request that was
 * approved or rejected goes back to pending on a new attempt: a decision made
 * last week should not lock someone out forever, and the member asking again is
 * the signal that the old answer no longer stands.
 *
 * Notification is decided here rather than at the call site so the cooldown is
 * testable and cannot be forgotten by the next caller.
 */
export async function requestAccess(who: AccessRequester): Promise<AccessOutcome> {
  const existing = await findRequest(who.telegramId);
  const now = new Date();
  const lastNotified = existing?.notifiedAt?.getTime() ?? 0;
  const notify = now.getTime() - lastNotified >= NOTIFY_COOLDOWN_MS;

  if (!existing) {
    const rows = await db
      .insert(accessRequests)
      .values({
        telegramId: who.telegramId,
        username: who.username ?? null,
        firstName: who.firstName ?? null,
        lastName: who.lastName ?? null,
        status: "pending",
        // Stamped here rather than after the send, so a crash between the two
        // cannot turn into a notification storm on the next tap.
        notifiedAt: notify ? now : null,
      })
      .returning();
    return { row: rows[0]!, notify, firstTime: true, previous: null };
  }

  const rows = await db
    .update(accessRequests)
    .set({
      username: who.username ?? existing.username,
      firstName: who.firstName ?? existing.firstName,
      lastName: who.lastName ?? existing.lastName,
      status: "pending",
      requestedAt: now,
      decidedAt: null,
      decidedBy: null,
      notifiedAt: notify ? now : existing.notifiedAt,
    })
    .where(eq(accessRequests.telegramId, who.telegramId))
    .returning();

  return { row: rows[0]!, notify, firstTime: false, previous: existing.status };
}

/** Records that the admins have just been told, so the cooldown restarts. */
export async function markNotified(telegramId: string): Promise<void> {
  await db
    .update(accessRequests)
    .set({ notifiedAt: new Date() })
    .where(eq(accessRequests.telegramId, telegramId));
}

export async function findRequest(telegramId: string): Promise<AccessRequestRow | null> {
  const rows = await db.select().from(accessRequests).where(eq(accessRequests.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

/** Newest first: the queue is about who needs a decision now. */
export async function listPendingRequests(limit = 50): Promise<AccessRequestRow[]> {
  return db
    .select()
    .from(accessRequests)
    .where(eq(accessRequests.status, "pending"))
    .orderBy(desc(accessRequests.requestedAt))
    .limit(limit);
}

export async function countPendingRequests(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(accessRequests)
    .where(eq(accessRequests.status, "pending"));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Moves a pending request to a final state.
 *
 * Guarded on the current status, so two admins tapping Approve and Reject at the
 * same moment cannot both record a decision: the loser is told the request was
 * already handled instead of quietly overwriting the winner. Returns null in that
 * case, which the caller reports as "already decided".
 */
export async function decideAccess(
  telegramId: string,
  status: Exclude<AccessRequestStatus, "pending">,
  byId: string,
): Promise<AccessRequestRow | null> {
  const rows = await db
    .update(accessRequests)
    .set({ status, decidedAt: new Date(), decidedBy: byId })
    .where(and(eq(accessRequests.telegramId, telegramId), eq(accessRequests.status, "pending")))
    .returning();
  return rows[0] ?? null;
}
