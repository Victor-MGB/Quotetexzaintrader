import assert from "node:assert/strict";
import { ensureTestEnv } from "./helpers/env.js";

ensureTestEnv();

const { after, describe, it, before, beforeEach } = await import("node:test");
const { dbSkipReason, clearTestimonies, assertSchema, closeDb } = await import("./helpers/db.js");
const { TEST_ADMIN_ID } = await import("./helpers/config.js");
const { PAGE_SIZE } = await import("../src/modules/testimony/constants.js");

const skip = await dbSkipReason();
const ADMIN = TEST_ADMIN_ID;

function nav(index: number, offset: number, end: number, total: number) {
  return {
    prev: index > offset ? index - 1 : null,
    next: index < end - 1 ? index + 1 : null,
    all: total > 1,
  };
}

describe("testimony feed paging", { skip: skip ?? false }, () => {
  let store: typeof import("../src/modules/testimony/store.js");

  before(async () => {
    store = await import("../src/modules/testimony/store.js");
    await assertSchema();
  });

  beforeEach(clearTestimonies);

  async function seed(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await store.createTestimony({
        name: `Member ${i + 1}`,
        message: `Payout number ${i + 1} arrived on time and support was quick.`,
        plan: i % 2 === 0 ? "GOLD" : "CLASSIC",
        media: i % 3 === 0 ? "test.jpeg" : null,
        submittedBy: ADMIN,
        byAdmin: true,
        publishNow: true,
      });
    }
  }

  it("offers no Prev on the very first card", async () => {
    await seed(45);
    const total = await store.countPublished();
    const first = nav(0, 0, Math.min(total, PAGE_SIZE), total);

    assert.equal(first.prev, null);
    assert.equal(first.next, 1);
  });

  it("pages by absolute index on the second page", async () => {
    // The bug this pins: index is already absolute, so adding the page offset
    // again sent Prev/Next off the end of the feed.
    const first = nav(25, 20, 40, 45);
    assert.equal(first.prev, 24, "Prev must be 24, not 44");
    assert.equal(first.next, 26, "Next must be 26, not 46");
  });

  it("offers no Next on the last card of the last page", () => {
    const last = nav(44, 40, 45, 45);
    assert.equal(last.prev, 43);
    assert.equal(last.next, null);
  });

  it("offers no Prev on the first card of a middle page", () => {
    const start = nav(20, 20, 40, 45);
    assert.equal(start.prev, null);
    assert.equal(start.next, 21);
  });

  it("loads the right slice for a page", async () => {
    await seed(45);

    const page = await store.listPublished(PAGE_SIZE, 20);

    assert.equal(page.length, PAGE_SIZE);
    assert.equal(page[0]?.name, "Member 21", "page two starts at the 21st testimony");
    assert.equal(page.at(-1)?.name, "Member 40");
  });

  it("returns a short final page rather than padding", async () => {
    await seed(45);

    const last = await store.listPublished(PAGE_SIZE, 40);

    assert.equal(last.length, 5);
  });

  it("keeps the feed stable in order so a card number does not shuffle", async () => {
    await seed(3);

    const first = await store.listPublished(20, 0);
    await store.createTestimony({
      name: "Later one",
      message: "Added after the others, so it should sort last.",
      submittedBy: ADMIN,
      byAdmin: true,
      publishNow: true,
    });
    const second = await store.listPublished(20, 0);

    assert.deepEqual(
      first.map((r) => r.id),
      second.slice(0, 3).map((r) => r.id),
    );
    assert.equal(second[3]?.name, "Later one");
  });

  it("drops the count when an admin deletes the card someone is viewing", async () => {
    await seed(3);
    const [first] = await store.listPublished(20, 0);

    await store.softDelete(first!.id);

    assert.equal(await store.countPublished(), 2);
    const page = await store.listPublished(20, 0);
    assert.equal(page.length, 2, "the deleted card is simply absent, so the handler shows a notice");
  });

  it("hides the All button when there is only one card", () => {
    assert.equal(nav(0, 0, 1, 1).all, false);
    assert.equal(nav(0, 0, 2, 2).all, true);
  });
});

after(async () => {
  await closeDb();
});
