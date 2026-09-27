import type { Message } from "grammy/types";
import { bot } from "../core/bot.js";
import { logger } from "../core/logger.js";
import { env } from "../core/config.js";
import type { MediaKind } from "./media.js";

/**
 * Telegram will not hand a bot anything above 20MB through getFile, so this is
 * the limit Telegram itself enforces rather than a policy choice.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Only formats a card can actually render. Telegram refuses most video formats
 * as a "video" and delivers the larger ones as a document, so the document
 * branch is not optional.
 */
const MIME_KINDS: Record<string, MediaKind> = {
  "image/jpeg": "photo",
  "image/jpg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "video/mp4": "video",
  "video/quicktime": "video",
};

export type AcceptedUpload = {
  fileId: string;
  size: number | undefined;
  kind: MediaKind;
  desiredName: string | null;
};

/**
 * Pulls usable media out of an incoming message.
 *
 * Separate from the network call on purpose: the interesting cases are all in
 * the shape of the message, which is testable without touching Telegram.
 * Returns null when the message simply carries no media we support, so a caller
 * can pass the update along instead of consuming it.
 */
export function resolveUpload(message: Message): AcceptedUpload | null {
  const photo = message.photo?.at(-1);
  if (photo) {
    return {
      fileId: photo.file_id,
      size: photo.file_size,
      kind: "photo",
      desiredName: message.caption ?? null,
    };
  }

  const video = message.video;
  if (video) {
    return {
      fileId: video.file_id,
      size: video.file_size,
      kind: "video",
      desiredName: message.caption ?? null,
    };
  }

  const doc = message.document;
  if (!doc?.mime_type) return null;

  const kind = MIME_KINDS[doc.mime_type];
  if (!kind) return null;

  // A document carries its own name, which beats an empty caption.
  return {
    fileId: doc.file_id,
    size: doc.file_size,
    kind,
    desiredName: message.caption ?? doc.file_name ?? null,
  };
}

/** Rejects an oversized file before spending a download on it. */
export function sizeRejected(size: number | undefined): string | null {
  if (size !== undefined && size > MAX_UPLOAD_BYTES) {
    return `That file is ${megabytes(size)}. Telegram only lets a bot read up to 20MB.`;
  }
  return null;
}

/**
 * Fetches a file Telegram is holding and returns its bytes. Errors carry a
 * message meant for the user, not a status code.
 */
export async function downloadUpload(fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  const response = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);

  if (!response.ok) {
    throw new Error(`Telegram would not hand the file over (HTTP ${response.status}).`);
  }

  const content = Buffer.from(await response.arrayBuffer());

  if (content.length > MAX_UPLOAD_BYTES) {
    throw new Error(`That file is ${megabytes(content.length)}, over the 20MB limit.`);
  }

  return content;
}

/** Wraps a download so the log line names the cause without leaking a token. */
export async function downloadSafely(fileId: string, context: string): Promise<Buffer> {
  try {
    return await downloadUpload(fileId);
  } catch (err) {
    logger.error({ err, context }, "telegram media download failed");
    throw err;
  }
}

export function megabytes(size: number): string {
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}
