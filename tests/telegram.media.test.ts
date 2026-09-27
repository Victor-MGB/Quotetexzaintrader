import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "grammy/types";
import { resolveUpload, sizeRejected, MAX_UPLOAD_BYTES } from "../src/shared/telegram-media.js";

/** Only the fields the resolver reads, so a test cannot drift into grammy. */
function message(over: Partial<Message>): Message {
  return over as Message;
}

describe("picking media out of an incoming message", () => {
  it("returns null for a plain text message", () => {
    assert.equal(resolveUpload(message({ text: "great payout" })), null);
  });

  it("returns null for media we cannot render, rather than guessing", () => {
    // A PDF has no place on a testimony card, and the caller needs to be able
    // to tell the member why nothing happened.
    assert.equal(
      resolveUpload(message({ document: { file_id: "f", file_unique_id: "u", mime_type: "application/pdf", file_name: "a.pdf" } })),
      null,
    );
  });

  it("takes the largest photo from the size ladder", () => {
    // Telegram sends a photo as several sizes; only the last is the original.
    const photo = (file_id: string, file_size: number) => ({
      file_id,
      file_unique_id: file_id,
      file_size,
      width: 1000,
      height: 1000,
    });
    const got = resolveUpload(
      message({ photo: [photo("small", 100), photo("medium", 900), photo("large", 9000)], caption: "my payout" }),
    );

    assert.deepEqual(got, { fileId: "large", size: 9000, kind: "photo", desiredName: "my payout" });
  });

  it("reads a video and treats the caption as the name", () => {
    const got = resolveUpload(
      message({
        video: { file_id: "v", file_unique_id: "u", mime_type: "video/mp4", file_size: 500, width: 640, height: 480, duration: 5 },
        caption: "screen",
      }),
    );

    assert.deepEqual(got, { fileId: "v", size: 500, kind: "video", desiredName: "screen" });
  });

  it("accepts a document, because Telegram will not classify most video formats as a video", () => {
    // This is the only route a long clip takes, so refusing documents here
    // would mean long videos are impossible.
    const got = resolveUpload(
      message({
        document: { file_id: "d", file_unique_id: "u", mime_type: "video/mp4", file_size: 20_000_000, file_name: "clip.mp4" },
      }),
    );

    assert.equal(got?.kind, "video");
    assert.equal(got?.fileId, "d");
  });

  it("prefers the caption over a document's own filename", () => {
    const got = resolveUpload(
      message({
        document: { file_id: "d", file_unique_id: "u", mime_type: "image/png", file_name: "Screenshot 2.png" },
        caption: "proof",
      }),
    );

    assert.equal(got?.desiredName, "proof");
  });

  it("falls back to the document filename when there is no caption", () => {
    const got = resolveUpload(
      message({ document: { file_id: "d", file_unique_id: "u", mime_type: "image/jpeg", file_name: "receipt.jpg" } }),
    );

    assert.equal(got?.desiredName, "receipt.jpg");
  });

  it("survives a document with no mime type", () => {
    assert.equal(resolveUpload(message({ document: { file_id: "d", file_unique_id: "u", file_name: "x" } })), null);
  });
});

describe("the 20MB bot limit", () => {
  it("rejects a file Telegram will not serve", () => {
    assert.ok(sizeRejected(MAX_UPLOAD_BYTES + 1));
    assert.match(sizeRejected(MAX_UPLOAD_BYTES + 1)!, /20MB/);
  });

  it("allows a file right at the limit", () => {
    assert.equal(sizeRejected(MAX_UPLOAD_BYTES), null);
  });

  it("cannot judge a file whose size Telegram did not report", () => {
    // Better to download and measure than to reject a legitimate upload.
    assert.equal(sizeRejected(undefined), null);
  });
});
