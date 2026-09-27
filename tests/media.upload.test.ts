import assert from "node:assert/strict";
import { ensureTestEnv } from "./helpers/env.js";

ensureTestEnv();

const { after, describe, it } = await import("node:test");
const { dbSkipReason, closeDb } = await import("./helpers/db.js");
const { naturalSort, safeStem, mediaByKey, mediaPath } = await import("../src/shared/media.js");

const skip = await dbSkipReason();

/**
 * safeStem decides where an admin-uploaded file lands on disk. The name comes
 * from a Telegram caption, which is arbitrary text from the internet, and the
 * result is joined onto a directory path. These cases are the difference
 * between "photo-8.jpeg" and something that escapes the library folder.
 */
describe("uploaded media naming", { skip: skip ?? false }, () => {
  it("keeps a plain name", () => {
    assert.equal(safeStem("sarah-payout", "photo-8"), "sarah-payout");
    assert.equal(safeStem("Sarah_Payout", "photo-8"), "Sarah_Payout");
  });

  it("strips a directory traversal instead of honouring it", () => {
    const stem = safeStem("../../etc/passwd", "photo-8");
    assert.ok(!stem.includes("/"), `got ${stem}`);
    assert.ok(!stem.includes(".."), `got ${stem}`);
  });

  it("strips an absolute path", () => {
    const stem = safeStem("/etc/shadow", "photo-8");
    assert.ok(!stem.startsWith("/"), `got ${stem}`);
    assert.ok(!stem.includes("/"), `got ${stem}`);
  });

  it("drops backslashes, which are separators on Windows", () => {
    const stem = safeStem("..\\..\\windows\\system32", "photo-8");
    assert.ok(!stem.includes("\\"), `got ${stem}`);
    assert.ok(!stem.includes(".."), `got ${stem}`);
  });

  it("will not produce a hidden file", () => {
    assert.ok(!safeStem(".bashrc", "photo-8").startsWith("."));
    assert.ok(!safeStem("...", "photo-8").startsWith("."));
  });

  it("strips characters that have no business in a filename", () => {
    const stem = safeStem('sa"rah; rm -rf /', "photo-8");
    assert.ok(!/[";]/.test(stem), `got ${stem}`);
  });

  it("ignores an extension in the caption, since the real file decides it", () => {
    // An admin captioning a photo "payload.sh" must not produce payload.sh.
    assert.equal(safeStem("payload.sh", "photo-8"), "payload");
  });

  it("falls back when the caption is empty or unusable", () => {
    assert.equal(safeStem("", "photo-8"), "photo-8");
    assert.equal(safeStem("   ", "photo-8"), "photo-8");
    assert.equal(safeStem(null, "video-4"), "video-4");
    assert.equal(safeStem(undefined, "photo-8"), "photo-8");
    assert.equal(safeStem("---", "photo-8"), "photo-8");
  });

  it("caps a very long name", () => {
    const stem = safeStem("x".repeat(500), "photo-8");
    assert.ok(stem.length <= 40, `length was ${stem.length}`);
  });
});

describe("media resolution is filesystem-backed", { skip: skip ?? false }, () => {
  it("refuses to resolve a traversal attempt", () => {
    for (const attempt of ["../secrets.env", "..%2Fsecrets", "/etc/passwd", "a/b.jpeg"]) {
      assert.equal(mediaPath(attempt), null, `${attempt} must not resolve`);
      assert.equal(mediaByKey(attempt), null, `${attempt} must not resolve`);
    }
  });

  it("returns null for a file that is not there, even with a real extension", () => {
    // Regression: inferring the kind from the extension alone reported a
    // deleted photo as still attached, so the admin preview claimed media that
    // was not there.
    assert.equal(mediaByKey("gone.jpeg"), null);
    assert.equal(mediaByKey("gone.mp4"), null);
  });

  it("still resolves the committed library", () => {
    assert.ok(mediaPath("photo-1.jpeg"));
    assert.equal(mediaByKey("photo-1.jpeg")?.kind, "photo");
    assert.equal(mediaByKey("video-1.mp4")?.kind, "video");
  });
});

describe("natural sort still holds", { skip: false }, () => {
  it("orders double digits after single ones", () => {
    const files = ["photo-10.jpeg", "video-2.mp4", "photo-2.jpeg", "video-10.mp4", "photo-1.jpeg"];
    assert.deepEqual([...files].sort(naturalSort), [
      "photo-1.jpeg",
      "photo-2.jpeg",
      "photo-10.jpeg",
      "video-2.mp4",
      "video-10.mp4",
    ]);
  });
});

after(async () => {
  await closeDb();
});
