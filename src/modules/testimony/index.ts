import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { escapeHtml } from "../../shared/html.js";
import { saveMedia } from "../../shared/media.js";
import { requireSession } from "../../shared/requireSession.js";
import { downloadSafely, resolveUpload, sizeRejected } from "../../shared/telegram-media.js";
import { notifyTestimonySubmitted } from "../admin/testimony.js";
import { showTestimonyCard, testimonyListText } from "./card.js";
import { PAGE_SIZE } from "./constants.js";
import { countPublished, createTestimony, listPublished } from "./store.js";
import type { TestimonyRow } from "./store.js";

const testimony = new Composer<AppContext>();

interface FeedPage {
  rows: TestimonyRow[];
  /** Every published testimony, not just this page. */
  total: number;
  /** Absolute index of the first row on this page. */
  offset: number;
  /** Absolute index one past the last row on this page, clamped to total. */
  end: number;
}

async function feedPage(offset: number): Promise<FeedPage> {
  const [rows, total] = await Promise.all([listPublished(PAGE_SIZE, offset), countPublished()]);
  return { rows, total, offset, end: Math.min(total, offset + rows.length) };
}

/**
 * `index` is absolute across the whole feed, so Prev and Next are plain index
 * arithmetic. The guards compare against the page bounds rather than the total,
 * which is what stops a card on page two from offering a Next that lands past
 * the end.
 */
function feedKeyboard(page: FeedPage, index: number): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (index > page.offset) kb.text("◀️ Prev", `tst:card_${index - 1}`);
  if (index < page.end - 1) kb.text("Next ▶️", `tst:card_${index + 1}`);
  if (page.total > 1) kb.row().text("📋 All", `tst:list_${page.offset}`);

  kb.row().text("✍️ Share Your Experience", "tst:share");
  return kb.row().text("⬅ Back", "main:menu").text("🏠 Main Menu", "main:menu");
}

testimony.callbackQuery("main:testimony", async (ctx) => {
  await ctx.answerCallbackQuery();

  const page = await feedPage(0);

  if (page.total === 0) {
    await ctx
      .editMessageText(
        `⭐ <b>TESTIMONY</b>

No member stories have been published yet.

💬 Been trading with us? Share your experience and an admin will review it before it appears here.`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("✍️ Share Your Experience", "tst:share")
            .row()
            .text("⬅ Back", "main:menu")
            .text("🏠 Main Menu", "main:menu"),
        },
      )
      .catch(() => undefined);
    return;
  }

  await showTestimonyCard(ctx, page.rows[0]!, 0, page.total, feedKeyboard(page, 0));
});

testimony.callbackQuery(/^tst:card_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const index = Number(ctx.match[1]);
  if (!Number.isInteger(index) || index < 0) return;

  const page = await feedPage(Math.floor(index / PAGE_SIZE) * PAGE_SIZE);
  const row = page.rows[index - page.offset];

  // Reachable when a testimony is removed while someone is looking at it, which
  // is exactly what the admin's delete button causes.
  if (!row) {
    await ctx
      .editMessageText("This one is no longer available.", {
        reply_markup: new InlineKeyboard().text("⬅ Testimony", "main:testimony"),
      })
      .catch(() => undefined);
    return;
  }

  await showTestimonyCard(ctx, row, index, page.total, feedKeyboard(page, index));
});

testimony.callbackQuery(/^tst:list_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const offset = Number(ctx.match[1]) || 0;
  const page = await feedPage(offset);

  await ctx
    .editMessageText(testimonyListText(page.rows), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🖼 Cards", `tst:card_${page.offset}`)
        .row()
        .text("✍️ Share Your Experience", "tst:share")
        .row()
        .text("⬅ Back", "main:menu")
        .text("🏠 Main Menu", "main:menu"),
    })
    .catch(() => undefined);
});

/**
 * A member part-way through submitting, keyed by telegram id so two members
 * drafting at once never share a draft.
 *
 * The expiry matters: without it a member who taps Cancel, or simply walks away,
 * leaves an entry behind, and their next unrelated message — a report, a
 * withdrawal figure, a chat with support — would be swallowed here and published
 * as a testimony. Process-local, so a restart drops drafts too.
 */
interface Draft {
  name: string;
  at: number;
}

const DRAFT_TTL_MS = 10 * 60_000;

const drafting = new Map<string, Draft>();

/** Returns a live draft, discarding one that has been abandoned too long. */
function liveDraft(id: string): Draft | null {
  const draft = drafting.get(id);
  if (!draft) return null;

  if (Date.now() - draft.at > DRAFT_TTL_MS) {
    drafting.delete(id);
    return null;
  }

  return draft;
}

/**
 * Submission is deliberately two buttons rather than a prompt: a member never
 * has to decide what to call themselves, and the two options cover the only
 * cases that matter — their own name, or no name at all.
 */
testimony.callbackQuery("tst:share", async (ctx) => {
  if (!(await requireSession(ctx))) return;

  await ctx.answerCallbackQuery();

  const label = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "your Telegram name";

  await ctx.reply(
    `✍️ <b>Share your experience</b>

Step 1 of 2 — how should your name appear?

Your message goes to an admin first. Nothing is published without a review, so
you can send exactly what you mean without worrying about it going live wrong.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text(`👤 Post as ${label.slice(0, 30)}`, "tst:name_me")
        .text("🕶️ Post anonymously", "tst:name_anon")
        .row()
        .text("✖ Cancel", "tst:cancel"),
    },
  );
});

testimony.callbackQuery(/^tst:name_(me|anon)$/, async (ctx) => {
  const id = String(ctx.from?.id ?? 0);
  const name =
    ctx.match[1] === "anon"
      ? "Anonymous member"
      : [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim() || "Anonymous member";

  drafting.set(id, { name, at: Date.now() });

  await ctx.answerCallbackQuery("Got it");
  await ctx.reply(
    `✅ Name set to <b>${escapeHtml(name)}</b>

Step 2 of 2 — tell everyone how it has been for you.

A couple of sentences about your plan and your payouts is plenty.

You can send a <b>photo or video</b> as well — put your message in the caption and it goes up with the picture, no admin step involved.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("✖ Cancel", "tst:cancel"),
    },
  );
});

testimony.callbackQuery("tst:cancel", async (ctx) => {
  drafting.delete(String(ctx.from?.id ?? 0));
  await ctx.answerCallbackQuery("Cancelled");
  await ctx
    .editMessageText("Cancelled. Nothing was sent.", { reply_markup: new InlineKeyboard().text("⬅ Testimony", "main:testimony") })
    .catch(() => undefined);
});

testimony.on("message:text", async (ctx, next: NextFunction) => {
  const id = String(ctx.from?.id ?? 0);
  const draft = liveDraft(id);
  if (!draft) return next();

  const text = ctx.message.text.trim();
  drafting.delete(id);

  if (text.length < 10) {
    await ctx.reply(
      "That was a little short to publish. Tell us a bit more about your experience — a sentence or two is plenty.",
      { reply_markup: new InlineKeyboard().text("✍️ Start again", "tst:share") },
    );
    return;
  }

  const row = await createTestimony({
    name: draft.name,
    message: text.slice(0, 1000),
    submittedBy: id,
    byAdmin: false,
    publishNow: false,
  });

  await ctx.reply("✅ Sent. An admin has been notified and will review it before it appears on the testimony page.", {
    reply_markup: new InlineKeyboard().text("🏠 Main Menu", "main:menu"),
  });

  await notifyTestimonySubmitted(row);
});

/**
 * A member sends a photo or clip instead of a bare message: the picture is
 * attached for them, and the caption becomes their words.
 *
 * The point is that nothing about the picture is an admin's job. Previously the
 * only media a testimony could ever carry was chosen by an admin from a fixed
 * library, so a member who sent a screenshot of their own payout had no way to
 * show it. The file still passes review with the rest of the submission, and it
 * still lands on disk in the same folder, so the known limit applies: an
 * ephemeral host loses these on redeploy.
 */
testimony.on(["message:photo", "message:video", "message:document"], async (ctx, next: NextFunction) => {
  const id = String(ctx.from?.id ?? 0);
  const draft = liveDraft(id);
  if (!draft) return next();
  if (!ctx.message) return next();

  const request = resolveUpload(ctx.message);
  if (!request) {
    // Some file type we cannot render. Say so rather than swallowing the update
    // and leaving the member staring at a draft that will never submit.
    drafting.delete(id);
    await ctx.reply(
      "⚠️ That file type cannot go on the testimony page. Send it as a photo, or as a video in MP4 format.",
      { reply_markup: new InlineKeyboard().text("✍️ Start again", "tst:share") },
    );
    return;
  }

  const text = (ctx.message.caption ?? "").trim();
  if (text.length < 10) {
    await ctx.reply(
      "📝 Add your message in the <b>caption</b> under the picture — a couple of sentences about your plan and payouts. Send it again with the caption filled in.",
      { parse_mode: "HTML" },
    );
    return;
  }

  const tooBig = sizeRejected(request.size);
  if (tooBig) {
    await ctx.reply(`📦 ${tooBig}`);
    return;
  }

  drafting.delete(id);
  const status = await ctx.reply("⏳ Attaching your picture…");
  let key: string;

  try {
    const content = await downloadSafely(request.fileId, "member testimony upload");
    // The caption is the member's testimony text, not a filename, so the media
    // is auto-named rather than named after what they wrote.
    key = saveMedia(content, request.kind, null);
  } catch (err) {
    await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
    await ctx.reply(`❌ ${err instanceof Error ? err.message : "That download failed."}`);
    return;
  }

  const row = await createTestimony({
    name: draft.name,
    message: text.slice(0, 1000),
    media: key,
    submittedBy: id,
    byAdmin: false,
    publishNow: false,
  });

  await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
  await ctx.reply("✅ Sent, with your picture. An admin will review it before it appears on the testimony page.", {
    reply_markup: new InlineKeyboard().text("🏠 Main Menu", "main:menu"),
  });

  await notifyTestimonySubmitted(row);
});

export { testimony };
