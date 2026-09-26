import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../core/db.js";
import { referrals } from "../../db/schema.js";

export const REFERRAL_PREFIX = "ref_";

export type ReferralRow = typeof referrals.$inferSelect;

/**
 * Returns the referrer's telegram id when the payload is a referral deep link.
 * Telegram start payloads are limited to 64 chars of [A-Za-z0-9_-], so the id
 * is matched explicitly rather than with \w+, which would also accept "_".
 */
export function parseReferralPayload(payload: string | undefined): string | null {
  const match = new RegExp(`^${REFERRAL_PREFIX}(\\d+)$`).exec(payload ?? "");
  return match?.[1] ?? null;
}

/**
 * First-touch attribution: the unique index on invitee_id means a second link
 * loses the insert, so a member cannot re-attribute an existing account.
 * Returns null when the invitee was already attributed to someone.
 */
export async function recordReferral(referrerId: string, inviteeId: string): Promise<ReferralRow | null> {
  const rows = await db
    .insert(referrals)
    .values({ referrerId, inviteeId })
    .onConflictDoNothing({ target: referrals.inviteeId })
    .returning();
  return rows[0] ?? null;
}

export interface ReferralTotals {
  joined: number;
  registered: number;
  qualified: number;
  paid: number;
}

const TOTALS = {
  joined: sql<number>`count(*)`,
  registered: sql<number>`count(*) filter (where ${referrals.status} = 'registered')`,
  qualified: sql<number>`count(*) filter (where ${referrals.status} = 'qualified')`,
  paid: sql<number>`count(*) filter (where ${referrals.rewardPaid})`,
};

interface TotalsRow {
  joined?: number | null;
  registered?: number | null;
  qualified?: number | null;
  paid?: number | null;
}

function toTotals(row: TotalsRow): ReferralTotals {
  return {
    joined: Number(row.joined ?? 0),
    registered: Number(row.registered ?? 0),
    qualified: Number(row.qualified ?? 0),
    paid: Number(row.paid ?? 0),
  };
}

export async function totalsForReferrer(referrerId: string): Promise<ReferralTotals> {
  const rows = await db.select(TOTALS).from(referrals).where(eq(referrals.referrerId, referrerId));
  return toTotals(rows[0] ?? {});
}

export async function listByReferrer(referrerId: string): Promise<ReferralRow[]> {
  return db
    .select()
    .from(referrals)
    .where(eq(referrals.referrerId, referrerId))
    .orderBy(desc(referrals.createdAt))
    .limit(50);
}

export interface ReferrerRow extends ReferralTotals {
  referrerId: string;
  /**
   * max(timestamp) is a raw aggregate, so postgres-js hands it back as a string
   * rather than the Date drizzle maps for real columns.
   */
  lastJoinedAt: string | null;
}

export async function referrerLeaderboard(limit = 100): Promise<ReferrerRow[]> {
  const rows = await db
    .select({
      referrerId: referrals.referrerId,
      lastJoinedAt: sql<string | null>`max(${referrals.createdAt})`,
      ...TOTALS,
    })
    .from(referrals)
    .groupBy(referrals.referrerId)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(limit);

  return rows.map((row) => ({ ...toTotals(row), referrerId: row.referrerId, lastJoinedAt: row.lastJoinedAt }));}

export async function grandTotals(): Promise<ReferralTotals> {
  const rows = await db.select(TOTALS).from(referrals);
  return toTotals(rows[0] ?? {});
}
