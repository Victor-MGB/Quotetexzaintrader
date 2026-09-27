import assert from "node:assert/strict";
import { ensureTestEnv } from "./helpers/env.js";

ensureTestEnv();

const { after, describe, it, before, beforeEach } = await import("node:test");
const { dbSkipReason, assertSchema, closeDb } = await import("./helpers/db.js");
const { EXPECTED, GUARD, TEST_ADMIN_ID, TEST_MEMBER_ID, TEST_WALLET_ADDRESS } = await import("./helpers/config.js");

const skip = await dbSkipReason();
const MEMBER = TEST_MEMBER_ID;

/**
 * This is the one suite that guards money. A withdrawal used to be debited
 * without being checked, so approving a $10,000 request on a $250 balance drove
 * the member negative. settle() now refuses under a row lock; these are the
 * cases that lock is there for, including the two that a naive check would
 * still fail.
 */
describe("withdrawal overdraw guard", { skip: skip ?? false }, () => {
  let store: typeof import("../src/modules/transactions/store.js");
  let eq: typeof import("drizzle-orm")["eq"];
  let db: typeof import("../src/core/db.js")["db"];
  let users: typeof import("../src/db/schema.js").users;
  let transactions: typeof import("../src/db/schema.js").transactions;

  before(async () => {
    store = await import("../src/modules/transactions/store.js");
    eq = (await import("drizzle-orm")).eq;
    db = (await import("../src/core/db.js")).db;
    ({ users, transactions } = await import("../src/db/schema.js"));
    await assertSchema();
  });

  beforeEach(async () => {
    await db.delete(transactions);
    // An UPDATE alone would silently match nothing on a fresh database, leaving
    // balance() to read undefined and every assertion to compare against NaN.
    await db
      .insert(users)
      .values({ telegramId: MEMBER, firstName: "Test", balance: GUARD.openingBalance })
      .onConflictDoUpdate({ target: users.telegramId, set: { balance: GUARD.openingBalance } });
  });

  const balance = async (): Promise<number> => {
    const rows = await db
      .select({ b: users.balance })
      .from(users)
      .where(eq(users.telegramId, MEMBER))
      .limit(1);
    return Number(rows[0]?.b);
  };

  const request = (amount: number) =>
    store.createTransaction({ telegramId: MEMBER, type: "withdrawal", amount, address: TEST_WALLET_ADDRESS });

  it("refuses the original exploit: $250 balance, $10,000 approved", async () => {
    const row = await request(GUARD.unaffordable);
    const result = await store.settle(row.id, "approved");

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "insufficient_funds");
    assert.equal(await balance(), EXPECTED.untouched, "the balance must not move");
  });

  it("leaves an unfundable withdrawal pending so an admin can fund it", async () => {
    const row = await request(GUARD.unaffordable);
    await store.settle(row.id, "approved");

    const after = await store.findTransaction(row.id);
    assert.equal(after?.status, "pending", "pending, not rejected — the fix is to top the balance up");
  });

  it("still pays a withdrawal the balance covers", async () => {
    const row = await request(GUARD.affordable);
    const result = await store.settle(row.id, "approved");

    assert.equal(result.ok, true);
    assert.equal(await balance(), EXPECTED.afterAffordable);
  });

  it("allows withdrawing the exact balance and lands on zero", async () => {
    const row = await request(GUARD.exact);
    const result = await store.settle(row.id, "approved");

    assert.equal(result.ok, true);
    assert.equal(await balance(), EXPECTED.empty, "zero, never negative");
  });

  it("refuses when the balance moved after the request was made", async () => {
    // A request-time check alone would pass this: the member asked for more than
    // they had, and an admin set the balance lower again before tapping Approve.
    const row = await request(GUARD.twiceAffordable);
    await store.adjustBalance({ telegramId: MEMBER, mode: "set", value: GUARD.reducedBalance, adminTelegramId: TEST_ADMIN_ID });

    const result = await store.settle(row.id, "approved");

    assert.equal(result.ok, false);
    assert.equal(await balance(), EXPECTED.afterReduced, "the adjustment stands");
  });

  it("lets only one of two simultaneous approvals through", async () => {
    // Both start in the same millisecond against one balance. The row lock is
    // what stops both clearing the opening balance and paying twice over.
    const a = await request(GUARD.affordable);
    const b = await request(GUARD.affordable);

    const [first, second] = await Promise.all([store.settle(a.id, "approved"), store.settle(b.id, "approved")]);
    const approved = [first, second].filter((r) => r.ok).length;

    assert.equal(approved, 1, "exactly one may be paid");
    assert.equal(await balance(), EXPECTED.afterAffordable, "never negative");
  });

  it("does not pay twice on a double tap", async () => {
    const row = await request(GUARD.tinyAffordable);

    const [first, second] = await Promise.all([store.settle(row.id, "approved"), store.settle(row.id, "approved")]);

    assert.equal([first, second].filter((r) => r.ok).length, 1);
    assert.equal(await balance(), EXPECTED.afterTinyAffordable, "charged once");
  });

  it("leaves deposits and rejections alone", async () => {
    const deposit = await store.createTransaction({ telegramId: MEMBER, type: "deposit", amount: GUARD.deposit });
    const credited = await store.settle(deposit.id, "approved");
    assert.equal(credited.ok, true);
    assert.equal(await balance(), EXPECTED.afterDeposit, "a deposit is never blocked by the withdrawal guard");

    const withdrawal = await request(GUARD.overdrafted);
    const rejected = await store.settle(withdrawal.id, "rejected");
    assert.equal(rejected.ok, true, "rejecting never needs funds");
    assert.equal(await balance(), EXPECTED.afterDeposit);
  });
});

after(async () => {
  await closeDb();
});
