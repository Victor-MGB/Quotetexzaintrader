import fs from "node:fs";
import { InputFile, type InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { escapeHtml } from "../../shared/html.js";
import { mediaSource } from "../../shared/media.js";
import type { TestimonyRow } from "./store.js";

/** Telegram rejects a caption over 1024 characters, and a member's text is unbounded. */
const CAPTION_LIMIT = 1024;

const QUOTED = /^\s*["“”']|["“”']\s*$/g;

/**
 * What the card message in each chat currently holds. Editing a photo into text
 * needs editMessageCaption while editing a plain message needs editMessageText,
 * and the wrong one fails outright, so the last known shape is remembered. This
 * is process-local like the rest of the bot's transient state: after a restart the
 * map is empty and the first edit simply falls through to the other call.
 */
const currentShape = new Map<string, "text" | "photo" | "video">();

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function isNotModified(err: unknown): boolean {
  return ((err as { description?: string }).description ?? "").includes("message is not modified");
}

/** Member text is pasted verbatim, so quotes and stray entities are normalised. */
function quote(text: string): string {
  return escapeHtml(text.replace(QUOTED, "").trim());
}

export function testimonyBody(row: TestimonyRow): string {
  // Name and plan appear exactly once. An earlier version repeated both in a
  // trailing "— Name · PLAN" signature on top of this header, so every card
  // showed its attribution twice.
  const plan = row.plan ? ` · <b>${escapeHtml(row.plan)}</b>` : "";
  return `<b>${escapeHtml(row.name)}</b>${plan}\n<i>"${quote(row.message)}"</i>`;
}

/** The card as plain text, used when a testimony has no media attached. */
export function testimonyText(row: TestimonyRow, index: number, total: number): string {
  return truncate(
    `⭐ <b>TESTIMONY</b> · ${index + 1} of ${total}\n\n${testimonyBody(row)}`,
    CAPTION_LIMIT,
  );
}

function chatKey(ctx: AppContext): string {
  return String(ctx.chat?.id ?? ctx.from?.id ?? 0);
}

/**
 * Draws one card into the caller's current message, replacing whatever was there.
 * The attempts run in order and the next is tried only if the previous one is
 * refused, so a card can move between text, photo and video in any direction
 * without knowing what the message held before.
 */
export async function showTestimonyCard(
  ctx: AppContext,
  row: TestimonyRow,
  index: number,
  total: number,
  keyboard: InlineKeyboard,
): Promise<void> {
  const key = chatKey(ctx);
  const source = await mediaSource(row.media);
  const shape: "text" | "photo" | "video" = source ? source.kind : "text";
  const text = testimonyText(row, index, total);

  // A committed file is streamed from disk; an upload is sent by short-lived
  // URL straight from storage, so nothing depends on the container having kept
  // its filesystem between deploys.
  const media = source
    ? source.url ?? new InputFile(fs.createReadStream(source.path!), source.key)
    : null;

  const editMedia = async (): Promise<void> => {
    await ctx.editMessageMedia(
      {
        type: source!.kind,
        media: media!,
        caption: text,
        parse_mode: "HTML",
        ...(source!.kind === "video" ? { supports_streaming: true } : {}),
      },
      { reply_markup: keyboard },
    );
  };
  const editText = async (): Promise<void> => {
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "HTML" });
  };
  const editCaption = async (): Promise<void> => {
    await ctx.editMessageCaption({ caption: text, reply_markup: keyboard, parse_mode: "HTML" });
  };

  // Media can be edited onto a text message directly, so when a file is present
  // it is always the first choice. Otherwise the remembered shape decides. An
  // unknown shape is treated as text, because that is what the feed is nearly
  // always entered from, and the other call remains as the fallback for a
  // message we have lost track of.
  const remembered = currentShape.get(key);
  const isMedia = remembered === "photo" || remembered === "video";
  const attempts =
    shape === "text" ? (isMedia ? [editCaption, editText] : [editText, editCaption]) : [editMedia];

  for (const attempt of attempts) {
    try {
      await attempt();
      currentShape.set(key, shape);
      return;
    } catch (err) {
      if (isNotModified(err)) {
        currentShape.set(key, shape);
        return;
      }
    }
  }

  // Nothing could be edited, which means this is not an editable message at all
  // (a message the bot did not send, or one older than Telegram's edit window).
  // Fall back to a fresh message so the member is never left on a dead screen.
  await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
  currentShape.set(key, shape);
}

/** A flat list of every published card, for members who would rather scan than swipe. */
export function testimonyListText(rows: TestimonyRow[]): string {
  if (rows.length === 0) {
    return `⭐ <b>TESTIMONY</b>

No member stories have been published yet.

💬 Been trading with us? Share your experience and it could appear here.`;
  }

  const entries = rows
    .map((row, index) => {
      const plan = row.plan ? ` · ${escapeHtml(row.plan)}` : "";
      return `<b>${index + 1}. ${escapeHtml(row.name)}</b>${plan}
${escapeHtml(truncate(row.message, 160))}`;
    })
    .join("\n\n");

  return truncate(`⭐ <b>TESTIMONY</b> · what members say\n\n${entries}`, 4000);
}
