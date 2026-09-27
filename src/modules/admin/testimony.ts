import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { bot } from "../../core/bot.js";
import { adminIds, env } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { escapeHtml } from "../../shared/html.js";
import { MEDIA_LIBRARY, mediaByKey, saveMedia, type MediaKind } from "../../shared/media.js";
import { PLANS } from "../plans/plans.js";
import { testimonyBody } from "../testimony/card.js";
import {
  countPending,
  createTestimony,
  listPending,
  listPublished,
  setStatus,
  softDelete,
  type TestimonyRow,
} from "../testimony/store.js";
import { isAdmin } from "./store.js";

export const testimonyAdmin = new Composer<AppContext>();

/**
 * An admin building a testimony one button at a time, keyed by admin id. Only the
 * words themselves are typed, since an arbitrary name cannot be reached by a
 * button; every choice around them is a tap. Process-local, so a restart simply
 * loses the draft.
 */
interface AdminDraft {
  name?: string;
  plan?: string | null;
  media?: string | null;
  message?: string;
  step: "name" | "plan" | "media" | "message" | "preview";
  /**
   * Set while the admin has been asked to send a file. Without it an incoming
   * photo would be swallowed mid-draft, and one sent when no draft exists would
   * never reach its real destination.
   */
  awaitingUpload?: boolean;
  at: number;
}

/** Long enough to write a testimony, short enough not to capture tomorrow's message. */
const DRAFT_TTL_MS = 15 * 60_000;

const drafts = new Map<string, AdminDraft>();

/**
 * Returns a live draft, discarding an abandoned one. Without this an admin who
 * starts a testimony and walks away would find their next typed message turned
 * into a published testimony under a name they never chose.
 */
function liveDraft(id: string): AdminDraft | null {
  const draft = drafts.get(id);
  if (!draft) return null;

  if (Date.now() - draft.at > DRAFT_TTL_MS) {
    drafts.delete(id);
    return null;
  }

  return draft;
}

function guard(ctx: AppContext): boolean {
  if (isAdmin(String(ctx.from?.id ?? 0))) return true;
  void ctx.answerCallbackQuery("Admins only").catch(() => undefined);
  return false;
}

function hubKeyboard(pending: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("➕ Add Testimony", "tstadmin:new")
    .row()
    .text("📋 Published", "tstadmin:manage");

  if (pending > 0) kb.text(`📥 Pending (${pending})`, "tstadmin:queue");
  return kb.row().text("⬅ Back", "admin:dashboard");
}

function cancelRow(kb: InlineKeyboard): InlineKeyboard {
  return kb.row().text("✖ Discard", "tstadmin:discard").text("⬅ Hub", "tstadmin:menu");
}

/** Short enough to sit under a card: "🖼 Photo 3" or "🎬 Video 1". */
function mediaLabel(index: number): string {
  return index === -1 ? "🚫 No media" : MEDIA_LIBRARY[index]?.label ?? "Unknown";
}

function mediaDescription(media: string | null | undefined): string {
  const item = mediaByKey(media);
  if (!item) return "no media attached";
  // The label alone leaves an uploaded file anonymous, so the chosen name is
  // shown too. This screen is admin-only; member cards never show a filename.
  return `${item.label} · ${item.key.replace(/\.[^.]+$/, "")}`;
}

function planKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const plan of PLANS) kb.text(plan.name, `tstadmin:p_${plan.key}`).row();
  kb.text("🚫 No plan", "tstadmin:p_none");
  return cancelRow(kb);
}

function mediaKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  MEDIA_LIBRARY.forEach((item, index) => {
    kb.text(mediaLabel(index), `tstadmin:m_${index}`);
    // Two per row keeps the picker tappable on a phone.
    if (index % 2 === 1) kb.row();
  });
  if (MEDIA_LIBRARY.length % 2 === 0) kb.row();
  kb.text("🚫 No media", "tstadmin:m_-1");
  // Uploading is the usual path; the library below it is for reusing shots that
  // are already in the repo.
  return cancelRow(kb.row().text("📎 Upload from my device", "tstadmin:m_upload"));
}

async function showHub(ctx: AppContext, note?: string): Promise<void> {
  const pending = await countPending();
  const text = [
    `⭐ <b>TESTIMONY ADMIN</b>`,
    "",
    note ? `${escapeHtml(note)}\n` : null,
    "Publish a testimony under any name, attach a photo or video, and remove any of them again with one tap.",
  ]
    .filter(Boolean)
    .join("\n");

  await ctx
    .editMessageText(text, { parse_mode: "HTML", reply_markup: hubKeyboard(pending) })
    .catch(() => undefined);
}

/** A published entry with a delete button, used by the manage list. */
function deleteButton(row: TestimonyRow): { text: string; data: string } {
  const plan = row.plan ? ` · ${row.plan}` : "";
  return { text: `🗑 ${row.name}${plan}`, data: `tstadmin:del_${row.id}` };
}

testimonyAdmin.callbackQuery("tstadmin:menu", async (ctx) => {
  if (!guard(ctx)) return;
  await ctx.answerCallbackQuery();
  await showHub(ctx);
});

testimonyAdmin.callbackQuery("tstadmin:new", async (ctx) => {
  if (!guard(ctx)) return;
  await ctx.answerCallbackQuery();

  const id = String(ctx.from?.id ?? 0);
  drafts.set(id, { step: "name", at: Date.now() });

  const label =
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim() || "your Telegram name";

  await ctx.reply(
    `⭐ <b>New testimony — step 1 of 4</b>

Whose name should this carry?

Anything you type here is what members will see. It does not have to be yours.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text(`👤 Post as ${label.slice(0, 24)}`, "tstadmin:name_me")
        .text("✏️ Use another name", "tstadmin:name_custom")
        .row()
        .text("✖ Discard", "tstadmin:discard"),
    },
  );
});

testimonyAdmin.callbackQuery("tstadmin:name_me", async (ctx) => {
  if (!guard(ctx)) return;

  const id = String(ctx.from?.id ?? 0);
  const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim() || "Anonymous member";
  const draft = liveDraft(id);
  if (draft) draft.name = name;

  await ctx.answerCallbackQuery("Name set");
  await ctx.reply(
    `✅ Name: <b>${escapeHtml(name)}</b>

Step 2 of 4 — which plan did this member trade?`,
    { parse_mode: "HTML", reply_markup: planKeyboard() },
  );
});

testimonyAdmin.callbackQuery("tstadmin:name_custom", async (ctx) => {
  if (!guard(ctx)) return;

  const draft = liveDraft(String(ctx.from?.id ?? 0));
  if (draft) draft.step = "name";

  await ctx.answerCallbackQuery("Type the name");
  await ctx.reply("✏️ Send the name this testimony should carry.");
});

testimonyAdmin.callbackQuery(/^tstadmin:p_(.+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = String(ctx.from?.id ?? 0);
  const draft = liveDraft(id);
  const choice = ctx.match[1];

  if (draft) draft.plan = choice === "none" ? null : (PLANS.find((p) => p.key === choice)?.name ?? null);

  await ctx.answerCallbackQuery("Plan set");
  await ctx.reply(
    `✅ Plan: <b>${escapeHtml(draft?.plan ?? "none")}</b>

Step 3 of 4 — attach a photo or video. This is what makes it read as real.`,
    { parse_mode: "HTML", reply_markup: mediaKeyboard() },
  );
});

/** Shared by the picker and the upload path, so both land on the same next step. */
async function mediaChosen(ctx: AppContext, draft: AdminDraft | null): Promise<void> {
  draft && (draft.awaitingUpload = false);
  await ctx.reply(
    `✅ Media: <b>${escapeHtml(mediaDescription(draft?.media ?? null))}</b>

Step 4 of 4 — send the message itself. Write it in the member's voice.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("✖ Discard", "tstadmin:discard"),
    },
  );
}

testimonyAdmin.callbackQuery(/^tstadmin:m_(-?\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = String(ctx.from?.id ?? 0);
  const draft = liveDraft(id);
  const index = Number(ctx.match[1]);

  if (draft) draft.media = index === -1 ? null : (MEDIA_LIBRARY[index]?.key ?? null);

  await ctx.answerCallbackQuery("Media set");
  await mediaChosen(ctx, draft);
});

testimonyAdmin.callbackQuery("tstadmin:m_upload", async (ctx) => {
  if (!guard(ctx)) return;

  const draft = liveDraft(String(ctx.from?.id ?? 0));
  if (draft) {
    draft.step = "media";
    draft.awaitingUpload = true;
  }

  await ctx.answerCallbackQuery("Send me the file");
  await ctx.reply(
    `📎 Send me a photo or a video from your phone or computer.

Put the name you want in the <b>caption</b> — leave it blank and I will number it for you.`,
    { parse_mode: "HTML" },
  );
});

/**
 * Telegram will not hand a bot anything above 20MB through getFile, so the limit
 * is checked against what Telegram reports before a download is attempted.
 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpeg",
  "image/jpg": ".jpeg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
};

async function receiveUpload(
  ctx: AppContext,
  draft: AdminDraft,
  fileId: string,
  size: number | undefined,
  kind: MediaKind,
  caption: string | undefined,
): Promise<void> {
  if (size !== undefined && size > MAX_UPLOAD_BYTES) {
    await ctx.reply(
      `📦 That file is ${(size / 1024 / 1024).toFixed(1)}MB. Telegram only lets a bot read up to 20MB — send it smaller, or a link instead.`,
    );
    return;
  }

  const status = await ctx.reply("⏳ Saving that…");
  let content: Buffer;

  try {
    const file = await bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(url);

    if (!response.ok) {
      await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
      await ctx.reply(`❌ Telegram would not hand the file over (HTTP ${response.status}). Try a smaller file.`);
      return;
    }

    content = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    logger.error({ err }, "testimony upload download failed");
    await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
    await ctx.reply("❌ That download failed. Check the connection and try again.");
    return;
  }

  if (content.length > MAX_UPLOAD_BYTES) {
    await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
    await ctx.reply(`📦 That file is ${(content.length / 1024 / 1024).toFixed(1)}MB, over the 20MB bot limit.`);
    return;
  }

  const key = saveMedia(content, kind, caption);
  draft.media = key;
  draft.step = "media";

  await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
  await mediaChosen(ctx, draft);
}

/** Photos arrive as a size ladder; the last entry is the original. */
function photoFileId(ctx: AppContext): { fileId: string; size: number | undefined } | null {
  const photo = ctx.message?.photo?.at(-1);
  return photo ? { fileId: photo.file_id, size: photo.file_size } : null;
}

testimonyAdmin.on("message:photo", async (ctx, next: NextFunction) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return next();
  const draft = liveDraft(String(ctx.from?.id ?? 0));
  if (!draft?.awaitingUpload) return next();

  const photo = photoFileId(ctx);
  if (!photo) return next();

  await receiveUpload(ctx, draft, photo.fileId, photo.size, "photo", ctx.message.caption);
});

testimonyAdmin.on("message:video", async (ctx, next: NextFunction) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return next();
  const draft = liveDraft(String(ctx.from?.id ?? 0));
  if (!draft?.awaitingUpload) return next();

  const video = ctx.message?.video;
  if (!video) return next();

  await receiveUpload(ctx, draft, video.file_id, video.file_size, "video", ctx.message.caption);
});

// Telegram refuses most video formats as a "video", so anything over 20MB
// arrives as a document instead. Accepting it is the only way to get a long
// clip in at all.
testimonyAdmin.on("message:document", async (ctx, next: NextFunction) => {
  if (!isAdmin(String(ctx.from?.id ?? 0))) return next();
  const draft = liveDraft(String(ctx.from?.id ?? 0));
  if (!draft?.awaitingUpload) return next();

  const doc = ctx.message?.document;
  if (!doc?.mime_type) return next();

  const extension = MIME_EXTENSIONS[doc.mime_type];
  if (!extension) return next();

  const kind: MediaKind = doc.mime_type.startsWith("video/") ? "video" : "photo";
  // The document's own name is a better label than the caption when both exist.
  await receiveUpload(ctx, draft, doc.file_id, doc.file_size, kind, ctx.message.caption ?? doc.file_name);
});

testimonyAdmin.on("message:text", async (ctx, next: NextFunction) => {
  const id = String(ctx.from?.id ?? 0);
  const draft = liveDraft(id);
  if (!draft) return next();

  const text = ctx.message.text.trim();

  if (draft.step === "name") {
    if (text.length < 2) {
      await ctx.reply("That name is too short to display. Send a longer one.");
      return;
    }
    draft.name = text.slice(0, 60);
    await ctx.reply(`✅ Name: <b>${escapeHtml(draft.name)}</b>\n\nStep 2 of 4 — which plan did this member trade?`, {
      parse_mode: "HTML",
      reply_markup: planKeyboard(),
    });
    return;
  }

  if (draft.step === "message") {
    if (text.length < 10) {
      await ctx.reply("Too short to publish as a testimony. Write a sentence or two.");
      return;
    }

    draft.message = text.slice(0, 1000);
    draft.step = "preview";

    await ctx.reply(
      `👀 <b>Preview — nothing is public yet</b>\n\n${testimonyBody({
        id: 0,
        name: draft.name ?? "",
        message: draft.message,
        plan: draft.plan ?? null,
        media: draft.media ?? null,
        status: "pending",
        submittedBy: id,
        byAdmin: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })}\n\nMedia: ${escapeHtml(mediaDescription(draft.media ?? null))}`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Publish", "tstadmin:publish")
          .row()
          .text("✏️ Rewrite message", "tstadmin:rewrite")
          .text("🖼 Change media", "tstadmin:change_media")
          .row()
          .text("✖ Discard", "tstadmin:discard"),
      },
    );
    return;
  }

  return next();
});

testimonyAdmin.callbackQuery("tstadmin:rewrite", async (ctx) => {
  if (!guard(ctx)) return;
  const draft = liveDraft(String(ctx.from?.id ?? 0));
  if (draft) draft.step = "message";
  await ctx.answerCallbackQuery("Send it again");
  await ctx.reply("✏️ Send the message again.");
});

testimonyAdmin.callbackQuery("tstadmin:change_media", async (ctx) => {
  if (!guard(ctx)) return;
  const draft = liveDraft(String(ctx.from?.id ?? 0));
  if (draft) draft.step = "media";
  await ctx.answerCallbackQuery("Pick media");
  await ctx.reply("🖼 Pick the photo or video for this testimony.", { reply_markup: mediaKeyboard() });
});

testimonyAdmin.callbackQuery("tstadmin:publish", async (ctx) => {
  if (!guard(ctx)) return;

  const id = String(ctx.from?.id ?? 0);
  const draft = liveDraft(id);

  if (!draft?.name || !draft.message) {
    await ctx.answerCallbackQuery("Incomplete");
    await ctx.reply("⚠️ That draft is incomplete. Start again from Add Testimony.");
    drafts.delete(id);
    return;
  }

  await ctx.answerCallbackQuery("Published");

  const row = await createTestimony({
    name: draft.name,
    message: draft.message,
    plan: draft.plan ?? null,
    media: draft.media ?? null,
    submittedBy: id,
    byAdmin: true,
    publishNow: true,
  });

  drafts.delete(id);

  await ctx.reply(
    `✅ <b>Published</b>\n\n${testimonyBody(row)}\n\nMembers see it on ⭐ Testimony. It can be removed at any time from Published.`,
    { parse_mode: "HTML" },
  );
  await showHub(ctx, `✅ Published "${escapeHtml(row.name)}".`);
});

testimonyAdmin.callbackQuery("tstadmin:discard", async (ctx) => {
  if (!guard(ctx)) return;
  drafts.delete(String(ctx.from?.id ?? 0));
  await ctx.answerCallbackQuery("Discarded");
  await showHub(ctx, "🗑 Draft discarded.");
});

testimonyAdmin.callbackQuery("tstadmin:manage", async (ctx) => {
  if (!guard(ctx)) return;
  await ctx.answerCallbackQuery();

  const rows = await listPublished(50);

  if (rows.length === 0) {
    await ctx
      .editMessageText("📋 <b>Published testimonies</b>\n\nNothing is published yet.", {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("⬅ Hub", "tstadmin:menu"),
      })
      .catch(() => undefined);
    return;
  }

  const kb = new InlineKeyboard();
  for (const row of rows) {
    const button = deleteButton(row);
    kb.text(button.text, button.data);
    if (rows.indexOf(row) % 2 === 1) kb.row();
  }
  if (rows.length % 2 === 0) kb.row();

  await ctx
    .editMessageText(
      `📋 <b>Published testimonies</b> · ${rows.length}\n\nTap one to remove it. Removal is reversible — you get an undo button straight after.`,
      { parse_mode: "HTML", reply_markup: kb.row().text("⬅ Hub", "tstadmin:menu") },
    )
    .catch(() => undefined);
});

/**
 * Removal is a soft state, so the same screen that took the entry down offers to
 * put it back. An accidental tap costs one extra tap, not a retyped testimony.
 */
testimonyAdmin.callbackQuery(/^tstadmin:del_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = Number(ctx.match[1]);
  const removed = await softDelete(id);

  if (!removed) {
    await ctx.answerCallbackQuery("Already removed");
    return;
  }

  await ctx.answerCallbackQuery("Removed");
  await ctx.editMessageText(
    `🗑 <b>Removed</b>\n\n<b>${escapeHtml(removed.name)}</b> is no longer on the testimony page.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("↩️ Undo", `tstadmin:undo_${removed.id}`)
        .row()
        .text("📋 Published", "tstadmin:manage")
        .text("⬅ Hub", "tstadmin:menu"),
    },
  );
});

testimonyAdmin.callbackQuery(/^tstadmin:undo_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = Number(ctx.match[1]);
  const restored = await setStatus(id, "deleted", "published");

  if (!restored) {
    await ctx.answerCallbackQuery("Cannot restore");
    return;
  }

  await ctx.answerCallbackQuery("Restored");
  await ctx.editMessageText(`↩️ <b>Restored</b>\n\n<b>${escapeHtml(restored.name)}</b> is back on the testimony page.`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("⬅ Hub", "tstadmin:menu"),
  });
});

testimonyAdmin.callbackQuery("tstadmin:queue", async (ctx) => {
  if (!guard(ctx)) return;
  await ctx.answerCallbackQuery();

  const rows = await listPending(20);

  if (rows.length === 0) {
    await ctx
      .editMessageText("📥 <b>Pending testimonies</b>\n\nThe queue is empty.", {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("⬅ Hub", "tstadmin:menu"),
      })
      .catch(() => undefined);
    return;
  }

  const kb = new InlineKeyboard();
  for (const row of rows) {
    const plan = row.plan ? ` · ${row.plan}` : "";
    kb.text(`✅ ${row.name}${plan}`, `tstadmin:ok_${row.id}`).text("🚫 Reject", `tstadmin:no_${row.id}`).row();
  }

  const preview = rows
    .slice(0, 3)
    .map((row) => `<b>${escapeHtml(row.name)}</b>\n${escapeHtml(row.message.slice(0, 200))}`)
    .join("\n\n");

  await ctx
    .editMessageText(
      `📥 <b>Pending testimonies</b> · ${rows.length}\n\n${preview}\n\n\nApprove puts one on the testimony page. Reject discards it.`,
      { parse_mode: "HTML", reply_markup: kb.row().text("⬅ Hub", "tstadmin:menu") },
    )
    .catch(() => undefined);
});

testimonyAdmin.callbackQuery(/^tstadmin:ok_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = Number(ctx.match[1]);
  const published = await setStatus(id, "pending", "published");

  if (!published) {
    await ctx.answerCallbackQuery("Already handled");
    return;
  }

  await ctx.answerCallbackQuery("Approved");
  await ctx.editMessageText(
    `✅ <b>Approved</b>\n\n<b>${escapeHtml(published.name)}</b> is now on the testimony page.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("⬅ Hub", "tstadmin:menu").row().text("📥 Queue", "tstadmin:queue"),
    },
  );
});

/** A rejection is recorded as a removal rather than a third state: the effect on the feed is identical. */
testimonyAdmin.callbackQuery(/^tstadmin:no_(\d+)$/, async (ctx) => {
  if (!guard(ctx)) return;

  const id = Number(ctx.match[1]);
  const removed = await setStatus(id, "pending", "deleted");

  if (!removed) {
    await ctx.answerCallbackQuery("Already handled");
    return;
  }

  await ctx.answerCallbackQuery("Rejected");
  await ctx.editMessageText(`🚫 Rejected <b>${escapeHtml(removed.name)}</b>.`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("⬅ Hub", "tstadmin:menu").row().text("📥 Queue", "tstadmin:queue"),
  });
});

/**
 * DMs every admin the moment a member submits, carrying the decision inline so
 * the queue needs no separate visit. Delivered per admin because that is the
 * channel this bot already uses for approvals, and a failure to reach one admin
 * must not stop the others.
 */
export async function notifyTestimonySubmitted(row: TestimonyRow): Promise<void> {
  const text = [
    `⭐ <b>New testimony submitted</b>`,
    "",
    `👤 <b>${escapeHtml(row.name)}</b>`,
    `🆔 <code>${escapeHtml(row.submittedBy)}</code>`,
    "",
    escapeHtml(row.message),
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("✅ Approve", `tstadmin:ok_${row.id}`)
    .text("🚫 Reject", `tstadmin:no_${row.id}`)
    .row()
    .text("📋 Open queue", "tstadmin:queue");

  for (const adminId of adminIds) {
    await bot.api
      .sendMessage(adminId, text, { reply_markup: keyboard, parse_mode: "HTML" })
      .catch((err) => logger.warn({ err, adminId }, "failed to notify admin of testimony"));
  }
}
