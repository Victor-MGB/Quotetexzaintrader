import assert from "node:assert/strict";
import { ensureTestEnv } from "./helpers/env.js";

ensureTestEnv();

const { after, describe, it, before, beforeEach } = await import("node:test");
const { dbSkipReason, clearTestimonies, assertSchema, closeDb } = await import("./helpers/db.js");
const { TEST_ADMIN_ID, TEST_MEMBER_ID, TEST_STRANGER_ID } = await import("./helpers/config.js");
const { mediaByKey, mediaCaptionTag, mediaPath, MEDIA_LIBRARY } = await import("../src/shared/media.js");
const { testimonyBody, testimonyListText, testimonyText } = await import("../src/modules/testimony/card.js");

const skip = await dbSkipReason();
const suite = (name: string, body: () => void) => describe(name, { skip: skip ?? false }, body);

const ADMIN = TEST_ADMIN_ID;
const MEMBER = TEST_MEMBER_ID;

function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Sarah K.",
    message: "Eight months in and payouts always landed on time.",
    plan: "GOLD",
    media: null as string | null,
    status: "published" as const,
    submittedBy: ADMIN,
    byAdmin: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

suite("testimony media library", () => {
  it("finds every photo and video on disk", () => {
    const photos = MEDIA_LIBRARY.filter((m) => m.kind === "photo");
    const videos = MEDIA_LIBRARY.filter((m) => m.kind === "video");

    assert.equal(photos.length, 7, "expected 7 photos in src/pictures");
    assert.equal(videos.length, 3, "expected 3 videos in src/videos");
  });

  it("sorts numerically so test2 comes before test10", () => {
    const keys = MEDIA_LIBRARY.filter((m) => m.kind === "photo").map((m) => m.key);
    assert.deepEqual(keys, [
      "test.jpeg",
      "test1.jpeg",
      "test2.jpeg",
      "test3.jpeg",
      "test4.jpeg",
      "test5.jpeg",
      "test6.jpeg",
    ]);
  });

  it("resolves every key to a file that exists", () => {
    for (const item of MEDIA_LIBRARY) {
      assert.ok(mediaPath(item.key), `${item.key} did not resolve`);
    }
  });

  it("returns null for an unknown key rather than throwing", () => {
    assert.equal(mediaPath("nope.jpeg"), null);
    assert.equal(mediaByKey("nope.jpeg"), null);
    assert.equal(mediaPath(null), null);
  });

  it("labels photos and videos differently", () => {
    assert.equal(mediaCaptionTag("test1.jpeg"), "🖼 Photo");
    assert.equal(mediaCaptionTag("vtest.mp4"), "🎬 Video");
  });
});

suite("testimony moderation", () => {
  let store: typeof import("../src/modules/testimony/store.js");
  let eq: typeof import("drizzle-orm")["eq"];
  let db: typeof import("../src/core/db.js")["db"];
  let testimonies: typeof import("../src/db/schema.js")["testimonies"];

  before(async () => {
    store = await import("../src/modules/testimony/store.js");
    eq = (await import("drizzle-orm")).eq;
    db = (await import("../src/core/db.js")).db;
    testimonies = (await import("../src/db/schema.js")).testimonies;
    await assertSchema();
  });

  beforeEach(clearTestimonies);

  it("holds a member submission out of the feed until an admin approves", async () => {
    const row = await store.createTestimony({
      name: "Anonymous member",
      message: "Paid out three times now, always inside the promised window.",
      submittedBy: MEMBER,
      byAdmin: false,
      publishNow: false,
    });

    assert.equal(row.status, "pending");
    assert.equal(await store.countPublished(), 0, "a pending testimony must not be public");
    assert.equal(await store.countPending(), 1, "but it must be in the admin queue");
  });

  it("publishes an admin-authored testimony immediately", async () => {
    const row = await store.createTestimony({
      name: "Sarah K.",
      message: "Eight months in and every payout has landed on time.",
      plan: "GOLD",
      media: "test2.jpeg",
      submittedBy: ADMIN,
      byAdmin: true,
      publishNow: true,
    });

    assert.equal(row.status, "published");
    assert.equal(await store.countPublished(), 1);
  });

  it("moves a submission from pending to published on approval", async () => {
    const row = await store.createTestimony({
      name: "Pending one",
      message: "Waiting on a decision from the team here.",
      submittedBy: MEMBER,
      byAdmin: false,
      publishNow: false,
    });

    const approved = await store.setStatus(row.id, "pending", "published");

    assert.equal(approved?.status, "published");
    assert.equal(await store.countPublished(), 1);
  });

  it("keeps a rejected submission out of the feed", async () => {
    const row = await store.createTestimony({
      name: "Spam bot",
      message: "buy crypto now at this link",
      submittedBy: TEST_STRANGER_ID,
      byAdmin: false,
      publishNow: false,
    });

    const rejected = await store.setStatus(row.id, "pending", "deleted");

    assert.equal(rejected?.status, "deleted");
    assert.equal(await store.countPublished(), 0);
    assert.equal(await store.countPending(), 0);
  });

  it("refuses a second approve so nobody is published twice", async () => {
    const row = await store.createTestimony({
      name: "Once only",
      message: "This should only ever be approved one single time.",
      submittedBy: MEMBER,
      byAdmin: false,
      publishNow: false,
    });

    assert.ok(await store.setStatus(row.id, "pending", "published"));
    assert.equal(await store.setStatus(row.id, "pending", "published"), null, "second tap must be a no-op");
  });

  it("refuses to approve a row that was never pending", async () => {
    const row = await store.createTestimony({
      name: "Admin written",
      message: "Published from the start, so it has no pending state to move from.",
      submittedBy: ADMIN,
      byAdmin: true,
      publishNow: true,
    });

    assert.equal(await store.setStatus(row.id, "pending", "published"), null);
  });

  it("removes with one tap and puts it back with undo", async () => {
    const row = await store.createTestimony({
      name: "Undo me",
      message: "Removed and then restored by the admin in a single tap.",
      media: "test.jpeg",
      submittedBy: ADMIN,
      byAdmin: true,
      publishNow: true,
    });

    const removed = await store.softDelete(row.id);
    assert.equal(removed?.status, "deleted");
    assert.equal(await store.countPublished(), 0);

    const restored = await store.setStatus(row.id, "deleted", "published");
    assert.equal(restored?.status, "published");
    assert.equal(await store.countPublished(), 1);
  });

  it("treats a repeated delete as a no-op", async () => {
    const row = await store.createTestimony({
      name: "Delete twice",
      message: "A double tap on the delete button should not do anything at all.",
      submittedBy: ADMIN,
      byAdmin: true,
      publishNow: true,
    });

    assert.ok(await store.softDelete(row.id));
    assert.equal(await store.softDelete(row.id), null, "the guard should refuse the second delete");
  });

  it("still renders as text when the media file has gone missing", async () => {
    const row = await store.createTestimony({
      name: "Media gone",
      message: "This one points at a file that was deleted from the folder.",
      media: "test1.jpeg",
      submittedBy: ADMIN,
      byAdmin: true,
      publishNow: true,
    });

    await db.update(testimonies).set({ media: "deleted-file.jpeg" }).where(eq(testimonies.id, row.id));
    const reloaded = await store.findTestimony(row.id);

    assert.ok(reloaded);
    assert.equal(mediaPath(reloaded!.media), null, "the missing file resolves to null");

    const text = testimonyText(reloaded!, 0, 1);
    assert.ok(text.includes("Media gone"));
    assert.ok(!text.includes("undefined"), "a missing file must not leak into the markup");
  });
});

suite("testimony card rendering", () => {
  it("escapes a member name that contains markup", () => {
    const html = testimonyBody(makeRow({ name: "<script>alert(1)</script>" }));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>"));
  });

  it("escapes ampersands in the message", () => {
    const html = testimonyBody(makeRow({ message: "fast & reliable" }));
    assert.ok(html.includes("&amp;"));
    assert.ok(!html.includes("& reliable"));
  });

  it("keeps quotes that appear inside the message", () => {
    const html = testimonyBody(makeRow({ message: 'She said "fast" and meant it' }));
    assert.ok(html.includes('"fast"'));
  });

  it("strips quotes that wrap the whole message so they do not double up", () => {
    const html = testimonyBody(makeRow({ message: '"great service"' }));
    assert.ok(html.includes('<i>"great service"</i>'));
    assert.ok(!html.includes('""'));
  });

  it("strips curly wrapping quotes too", () => {
    const html = testimonyBody(makeRow({ message: "“smart quotes”" }));
    assert.ok(html.includes('<i>"smart quotes"</i>'));
  });

  it("clamps the caption to Telegram's 1024 character limit", () => {
    const text = testimonyText(makeRow({ message: "x".repeat(5000) }), 0, 99);
    assert.ok(text.length <= 1024, `length was ${text.length}`);
    assert.ok(text.includes("1 of 99"));
  });

  it("shows the plan when there is one", () => {
    assert.ok(testimonyBody(makeRow({ plan: "GOLD" })).includes("GOLD"));
    assert.ok(!testimonyBody(makeRow({ plan: null })).includes("PLAN"));
  });

  it("renders a full list view", () => {
    const list = testimonyListText([
      makeRow({ name: "Sarah K." }),
      makeRow({ id: 2, name: "Marcus T.", plan: "CLASSIC" }),
    ]);

    assert.ok(list.includes("TESTIMONY"));
    assert.ok(list.includes("Sarah K."));
    assert.ok(list.includes("Marcus T."));
    assert.ok(list.includes("CLASSIC"));
  });

  it("handles an empty feed without breaking", () => {
    const list = testimonyListText([]);
    assert.ok(list.includes("No member stories"));
  });
});

after(async () => {
  await closeDb();
});
