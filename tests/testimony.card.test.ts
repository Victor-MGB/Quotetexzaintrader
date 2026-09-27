import assert from "node:assert/strict";
import { ensureTestEnv } from "./helpers/env.js";

ensureTestEnv();

const { after, describe, it, before } = await import("node:test");
const { dbSkipReason, assertSchema , closeDb } = await import("./helpers/db.js");
const { showTestimonyCard } = await import("../src/modules/testimony/card.js");

const skip = await dbSkipReason();

/**
 * The card has to discover which edit call the current message will accept: a
 * photo message refuses editMessageText, a plain message refuses
 * editMessageCaption, and editMessageMedia replaces either. These tests record
 * the order the card tries, so the fallback is pinned rather than assumed.
 *
 * No database is needed here, but the module imports the app's config through
 * bot.js, so the environment still has to be present.
 */
describe("testimony card edit cascade", { skip: skip ?? false }, () => {
  before(async () => {
    await assertSchema().catch(() => undefined);
  });

  const row = (over: Record<string, unknown> = {}) => ({
    id: 1,
    name: "Sarah K.",
    message: "Eight months in and payouts always landed on time.",
    plan: "GOLD",
    media: null as string | null,
    status: "published" as const,
    submittedBy: "1",
    byAdmin: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  type Verdict = boolean | "notmodified";

  function mockCtx(chatId: number, accept: Record<string, Verdict>) {
    const calls: string[] = [];

    const attempt = (name: string) => async () => {
      calls.push(name);
      const verdict = accept[name];
      if (verdict === true || verdict === undefined) return;

      // grammy surfaces the server text in `description`, and that is the
      // property the card inspects, so the mock has to set it too.
      const description =
        verdict === "notmodified" ? "Bad Request: message is not modified" : "Bad Request: message is not editable";
      throw Object.assign(new Error(description), { description });
    };

    const ctx = {
      chat: { id: chatId },
      from: { id: chatId },
      editMessageText: attempt("editMessageText"),
      editMessageCaption: attempt("editMessageCaption"),
      editMessageMedia: attempt("editMessageMedia"),
      reply: attempt("reply"),
    };

    return { ctx: ctx as never, calls };
  }

  it("edits a photo onto the plain message it was opened from", async () => {
    const { ctx, calls } = mockCtx(9101, { editMessageMedia: true, editMessageText: true });

    await showTestimonyCard(ctx, row({ media: "photo-3.jpeg" }), 0, 3, {} as never);

    assert.deepEqual(calls, ["editMessageMedia"]);
  });

  it("uses the same call for a video card", async () => {
    const { ctx, calls } = mockCtx(9102, { editMessageMedia: true });

    await showTestimonyCard(ctx, row({ media: "video-1.mp4" }), 1, 3, {} as never);

    assert.deepEqual(calls, ["editMessageMedia"]);
  });

  it("treats an unknown message shape as text, the way the feed is entered", async () => {
    const { ctx, calls } = mockCtx(9103, { editMessageMedia: true, editMessageText: true, editMessageCaption: true });

    await showTestimonyCard(ctx, row({ media: null }), 0, 3, {} as never);

    assert.equal(calls[0], "editMessageText", "the main menu it came from is a text message");
  });

  it("swings from a photo card to a text card via the caption", async () => {
    const { ctx, calls } = mockCtx(9104, {
      editMessageMedia: true,
      editMessageCaption: true,
      editMessageText: false,
    });

    await showTestimonyCard(ctx, row({ media: "photo-2.jpeg" }), 0, 3, {} as never);
    await showTestimonyCard(ctx, row({ media: null }), 1, 3, {} as never);

    assert.equal(calls.at(-1), "editMessageCaption");
    assert.ok(!calls.slice(1).includes("editMessageText"), "should not waste a call the shape already rules out");
  });

  it("swings back from a text card to a photo card", async () => {
    const { ctx, calls } = mockCtx(9105, {
      editMessageMedia: true,
      editMessageText: true,
      editMessageCaption: true,
    });

    await showTestimonyCard(ctx, row({ media: null }), 0, 3, {} as never);
    await showTestimonyCard(ctx, row({ media: "photo-4.jpeg" }), 1, 3, {} as never);

    assert.equal(calls[1], "editMessageMedia");
  });

  it('treats "message is not modified" as success and stops', async () => {
    const { ctx, calls } = mockCtx(9106, { editMessageText: "notmodified" });

    await showTestimonyCard(ctx, row({ media: null }), 0, 3, {} as never);

    assert.deepEqual(calls, ["editMessageText"], "must not fall through to another call");
    assert.ok(!calls.includes("reply"), "must not resend a duplicate message");
  });

  it("sends a fresh message when nothing about the old one is editable", async () => {
    const { ctx, calls } = mockCtx(9107, {
      editMessageText: false,
      editMessageCaption: false,
      editMessageMedia: false,
      reply: true,
    });

    await showTestimonyCard(ctx, row({ media: "photo-1.jpeg" }), 0, 3, {} as never);

    assert.equal(calls.at(-1), "reply", "a member should never be stranded on a dead screen");
  });
});

after(async () => {
  await closeDb();
});
