import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../../core/db.js";
import { testimonies, type TestimonyStatus } from "../../db/schema.js";

export type TestimonyRow = typeof testimonies.$inferSelect;

export interface NewTestimony {
  name: string;
  message: string;
  plan?: string | null;
  media?: string | null;
  submittedBy: string;
  byAdmin: boolean;
  /** Admin-authored entries skip the queue; a member's always wait for a review. */
  publishNow: boolean;
}

export async function createTestimony(input: NewTestimony): Promise<TestimonyRow> {
  const rows = await db
    .insert(testimonies)
    .values({
      name: input.name,
      message: input.message,
      plan: input.plan ?? null,
      media: input.media ?? null,
      submittedBy: input.submittedBy,
      byAdmin: input.byAdmin,
      status: input.publishNow ? "published" : "pending",
    })
    .returning();

  return rows[0]!;
}

/** The public feed, oldest first so a card order stays stable between visits. */
export async function listPublished(limit = 50, offset = 0): Promise<TestimonyRow[]> {
  return db
    .select()
    .from(testimonies)
    .where(eq(testimonies.status, "published"))
    .orderBy(asc(testimonies.id))
    .limit(limit)
    .offset(offset);
}

export async function countPublished(): Promise<number> {
  const rows = await db.select({ n: count() }).from(testimonies).where(eq(testimonies.status, "published"));
  return Number(rows[0]?.n ?? 0);
}

/** Newest first: the queue is about what needs a decision now. */
export async function listPending(limit = 50): Promise<TestimonyRow[]> {
  return db
    .select()
    .from(testimonies)
    .where(eq(testimonies.status, "pending"))
    .orderBy(desc(testimonies.id))
    .limit(limit);
}

export async function countPending(): Promise<number> {
  const rows = await db.select({ n: count() }).from(testimonies).where(eq(testimonies.status, "pending"));
  return Number(rows[0]?.n ?? 0);
}

export async function findTestimony(id: number): Promise<TestimonyRow | null> {
  const rows = await db.select().from(testimonies).where(eq(testimonies.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Status moves are guarded on the current value so a second tap on Approve, or a
 * delete arriving while a publish is in flight, cannot walk the row backwards
 * into a state an admin did not intend.
 */
export async function setStatus(
  id: number,
  from: TestimonyStatus,
  to: TestimonyStatus,
): Promise<TestimonyRow | null> {
  const rows = await db
    .update(testimonies)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(testimonies.id, id), eq(testimonies.status, from)))
    .returning();

  return rows[0] ?? null;
}

/** Every state a row can be withdrawn from, so a soft delete is always possible. */
export async function softDelete(id: number): Promise<TestimonyRow | null> {
  const rows = await db
    .update(testimonies)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(sql`${testimonies.id} = ${id} and ${testimonies.status} <> 'deleted'`)
    .returning();

  return rows[0] ?? null;
}
