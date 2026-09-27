import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../core/db.js";
import { transactions, users, type TransactionStatus, type TransactionType } from "../../db/schema.js";

export type TransactionRow = typeof transactions.$inferSelect;

export async function createTransaction({
  telegramId,
  type,
  amount,
  method,
  reference,
  address,
}: {
  telegramId: string;
  type: TransactionType;
  amount?: number;
  method?: string;
  reference?: string;
  address?: string;
}): Promise<TransactionRow> {
  const rows = await db
    .insert(transactions)
    .values({ telegramId, type, amount, method, reference, address })
    .returning();
  return rows[0]!;
}

export async function findTransaction(id: number): Promise<TransactionRow | null> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listByUser(telegramId: string, limit = 20): Promise<TransactionRow[]> {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.telegramId, telegramId))
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
}

export async function listByStatus(status: TransactionStatus, limit = 20): Promise<TransactionRow[]> {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.status, status))
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
}

export async function countByStatus(status: TransactionStatus): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.status, status));
  return Number(rows[0]?.n ?? 0);
}

export async function userTotals(telegramId: string): Promise<{ approvedIn: number; approvedOut: number }> {
  const rows = await db
    .select({
      inTotal: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'approved' and ${transactions.type} = 'deposit'), 0)::int`,
      outTotal: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'approved' and ${transactions.type} = 'withdrawal'), 0)::int`,
    })
    .from(transactions)
    .where(eq(transactions.telegramId, telegramId));

  return {
    approvedIn: Number(rows[0]?.inTotal ?? 0),
    approvedOut: Number(rows[0]?.outTotal ?? 0),
  };
}

/**
 * Why a settle did not happen. "not_pending" means another admin got there
 * first, "insufficient_funds" means the withdrawal no longer covers the balance,
 * which can happen between requesting and approving if the member was debited in
 * the meantime.
 */
export type SettleFailure = "not_pending" | "insufficient_funds";

export type SettleResult =
  | { ok: true; row: TransactionRow }
  | { ok: false; reason: SettleFailure; requested?: number; available?: number };

/**
 * Moves a pending transaction to a final state and, on approval, applies the
 * balance change in the same transaction. The status guard means a second tap
 * on Approve matches no rows, so nobody gets credited twice.
 *
 * A withdrawal is checked against the member's balance while holding a FOR UPDATE
 * lock on their row, and the check happens before anything is written. That is
 * the only place the figure is guaranteed current: a request-time check alone
 * would go stale the moment the balance moves, and two admins approving at once
 * would both pass it. An unfundable withdrawal is left pending rather than
 * rejected, so the admin can top the balance up and approve it as it stands.
 */
export async function settle(
  id: number,
  status: Exclude<TransactionStatus, "pending">,
  opts: { amount?: number; note?: string } = {},
): Promise<SettleResult> {
  return db.transaction(async (tx) => {
    if (status === "approved") {
      const claim = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.status, "pending")))
        .limit(1)
        .for("update");
      const claimRow = claim[0];
      if (!claimRow) return { ok: false, reason: "not_pending" };

      if (claimRow.type === "withdrawal" && claimRow.amount) {
        const locked = await tx
          .select()
          .from(users)
          .where(eq(users.telegramId, claimRow.telegramId))
          .limit(1)
          .for("update");
        const available = locked[0]?.balance ?? 0;
        if (claimRow.amount > available) {
          return { ok: false, reason: "insufficient_funds", requested: claimRow.amount, available };
        }
      }
    }

    const rows = await tx
      .update(transactions)
      .set({
        status,
        amount: opts.amount ?? undefined,
        note: opts.note ?? undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, id), eq(transactions.status, "pending")))
      .returning();
    const row = rows[0];
    if (!row) return { ok: false, reason: "not_pending" };

    if (status === "approved" && row.amount) {
      const delta = row.type === "deposit" ? row.amount : -row.amount;
      await tx
        .update(users)
        .set({ balance: sql`${users.balance} + ${delta}`, updatedAt: new Date() })
        .where(eq(users.telegramId, row.telegramId));
    }
    return { ok: true, row };
  });
}
