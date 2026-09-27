import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { mediaKindFor, mediaSource, safeStem } from "../src/shared/media.js";
import { contentTypeFor, storageEnabled, mayUseDisk } from "../src/shared/media-store.js";

/**
 * Storage is off in the test environment, so these cover the behaviour that
 * matters without a network: what is treated as which kind, where media is
 * allowed to be written, and that resolution never invents a source.
 */
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env.SUPABASE_URL = ORIGINAL_ENV.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_KEY = ORIGINAL_ENV.SUPABASE_SERVICE_KEY;
});

function configureStorage(url?: string, key?: string): void {
  if (url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = url;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_KEY;
  else process.env.SUPABASE_SERVICE_KEY = key;
}

describe("telling a photo from a clip", () => {
  it("uses the extension for anything, with no claim it exists", () => {
    // The reason this is separate from mediaByKey: an upload lives in storage,
    // so it is in no library and on no disk, yet the card still has to know it
    // is a photo in order to send it.
    assert.equal(mediaKindFor("photo-9.jpeg"), "photo");
    assert.equal(mediaKindFor("whatever-4.png"), "photo");
    assert.equal(mediaKindFor("clip-2.mp4"), "video");
    assert.equal(mediaKindFor("VIDEO-1.MP4"), "video", "extension case should not matter");
  });

  it("returns null for something that is neither", () => {
    assert.equal(mediaKindFor("notes.pdf"), null);
    assert.equal(mediaKindFor("noextension"), null);
    assert.equal(mediaKindFor(null), null);
  });

  it("refuses a traversal attempt rather than describing it", () => {
    assert.equal(mediaKindFor("../../etc/passwd"), null);
    assert.equal(mediaKindFor("a/b.jpeg"), null);
    assert.equal(mediaKindFor("/etc/passwd"), null);
  });

  it("still reads the committed library", () => {
    assert.equal(mediaKindFor("photo-1.jpeg"), "photo");
    assert.equal(mediaKindFor("video-1.mp4"), "video");
  });
});

describe("storage has to be fully configured to count as configured", () => {
  it("is off with neither variable", () => {
    configureStorage(undefined, undefined);
    assert.equal(storageEnabled(), false);
  });

  it("is off with only the project url", () => {
    // Half a configuration would fail on every single upload instead of once,
    // at startup.
    configureStorage("https://example.supabase.co", undefined);
    assert.equal(storageEnabled(), false);
  });

  it("is off with only the key", () => {
    configureStorage(undefined, "some-key");
    assert.equal(storageEnabled(), false);
  });

  it("is on with both", () => {
    configureStorage("https://example.supabase.co", "some-key");
    assert.equal(storageEnabled(), true);
  });
});

describe("content types for storage", () => {
  it("maps each extension a card can render", () => {
    assert.equal(contentTypeFor("a.jpeg"), "image/jpeg");
    assert.equal(contentTypeFor("a.png"), "image/png");
    assert.equal(contentTypeFor("a.webp"), "image/webp");
    assert.equal(contentTypeFor("a.mp4"), "video/mp4");
  });

  it("falls back rather than sending nothing", () => {
    assert.equal(contentTypeFor("a.xyz"), "application/octet-stream");
  });
});

describe("resolving media to something sendable", () => {
  it("streams the committed library from disk", async () => {
    const source = await mediaSource("photo-1.jpeg");
    assert.equal(source?.kind, "photo");
    assert.ok(source?.path, "a committed file should come off disk");
    assert.equal(source?.url, undefined);
  });

  it("returns null for a file that is nowhere, rather than guessing", async () => {
    assert.equal(await mediaSource("gone.jpeg"), null);
    assert.equal(await mediaSource("nowhere.mp4"), null);
  });

  it("refuses a traversal attempt", async () => {
    assert.equal(await mediaSource("../../etc/passwd"), null);
  });

  it("returns null when there is no media at all", async () => {
    assert.equal(await mediaSource(null), null);
  });
});

describe("writing media", () => {
  it("refuses a name that would escape the folder", () => {
    const stem = safeStem("../../evil", "photo-99");
    assert.ok(!stem.includes("/") && !stem.includes(".."), stem);
  });

  it("allows disk outside production", () => {
    // Deliberately not exercised by writing a real file: the disk folder is the
    // committed media library, and a test that drops a file in it changes what
    // every other test sees.
    assert.equal(mayUseDisk(), true);
  });
});
