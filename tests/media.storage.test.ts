import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The Storage REST calls run against a throwaway server on localhost.
 *
 * This is not ceremony: the first version of listMedia omitted the `prefix` the
 * API requires, so it answered 400 and reported an empty bucket. Nothing else
 * could have caught that, because a unit test with a mocked fetch would only
 * have asserted the mock's own behaviour. Talking to something that behaves like
 * the real endpoint is the only version of this worth having.
 */

interface Recorded {
  method: string;
  path: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

let server: Server;
let origin: string;
let calls: Recorded[] = [];
/** What the fake should answer for a listing, per path. */
let listing: unknown = [{ name: "photo-8.jpeg" }];
/** Paths the fake should reject, to exercise the failure paths. */
let failing = new Set<string>();

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls.push({ method: req.method ?? "", path: req.url ?? "", body, headers: req.headers });

      if (failing.has(req.url ?? "")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "bad request" }));
        return;
      }

      if (req.url?.startsWith("/storage/v1/object/list/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(listing));
        return;
      }

      if (req.method === "POST" && req.url === "/storage/v1/bucket") {
        // The bucket already exists in a real project, so this is the 400 the
        // caller is expected to shrug off.
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "already exists" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ signedURL: `/object/sign/testimony-media/x.jpeg?token=abc` }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;

  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SERVICE_KEY = "test-key";
});

after(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("talking to media storage", () => {
  it("creates the bucket once and shrugs off it already existing", async () => {
    const { putMedia } = await import("../src/shared/media-store.js");
    await putMedia("photo-9.jpeg", Buffer.from("bytes"));

    const bucketCalls = calls.filter((c) => c.path === "/storage/v1/bucket");
    assert.equal(bucketCalls.length, 1, "the bucket should be checked once, not per upload");
  });

  it("uploads under the bucket with upsert off, so nothing is overwritten", async () => {
    calls = [];
    const { putMedia } = await import("../src/shared/media-store.js");
    await putMedia("photo-9.jpeg", Buffer.from("bytes"));

    const upload = calls.find((c) => c.method === "POST" && c.path.includes("/object/"));
    assert.ok(upload, "an upload should have been attempted");
    assert.equal(upload!.path, "/storage/v1/object/testimony-media/photo-9.jpeg");
    assert.equal(upload!.headers["x-upsert"], "false");
    assert.equal(upload!.headers["content-type"], "image/jpeg");
    assert.equal(upload!.headers["authorization"], "Bearer test-key");
  });

  it("lists with the prefix the API requires", async () => {
    // The regression: without prefix the endpoint answers 400 and the bucket
    // looks empty, so auto-numbering hands out a filename that already exists.
    calls = [];
    const { listMedia } = await import("../src/shared/media-store.js");
    const names = await listMedia();

    const list = calls.find((c) => c.path.startsWith("/storage/v1/object/list/"));
    assert.ok(list, "a listing should have been attempted");
    assert.equal(JSON.parse(list!.body).prefix, "", "prefix is required and empty means the whole bucket");
    assert.deepEqual(names, ["photo-8.jpeg"]);
  });

  it("reads an empty bucket as empty rather than failing an upload", async () => {
    calls = [];
    listing = [];
    const { listMedia } = await import("../src/shared/media-store.js");
    assert.deepEqual(await listMedia(), []);
    listing = [{ name: "photo-8.jpeg" }];
  });

  it("treats a rejected listing as empty instead of throwing", async () => {
    // A storage outage must not stop a testimony being submitted.
    calls = [];
    failing = new Set(["/storage/v1/object/list/testimony-media"]);
    const { listMedia } = await import("../src/shared/media-store.js");
    assert.deepEqual(await listMedia(), []);
    failing = new Set();
  });

  it("builds a signed URL from the project's own address", async () => {
    const { signedMediaUrl } = await import("../src/shared/media-store.js");
    const url = await signedMediaUrl("photo-8.jpeg");

    assert.ok(url?.startsWith(`${origin}/storage/v1/`), `got ${url}`);
    assert.match(url!, /token=abc/);
  });

  it("returns null rather than a broken URL when signing fails", async () => {
    failing = new Set(["/storage/v1/object/sign/testimony-media/gone.jpeg"]);
    const { signedMediaUrl } = await import("../src/shared/media-store.js");
    assert.equal(await signedMediaUrl("gone.jpeg"), null);
    failing = new Set();
  });

  it("refuses to write when storage is not configured", async () => {
    // A production bot must say so rather than write to a disk that will be
    // wiped on the next deploy.
    delete process.env.SUPABASE_URL;
    const { putMedia } = await import("../src/shared/media-store.js");
    await assert.rejects(() => putMedia("x.jpeg", Buffer.from("x")), /not configured/);
    process.env.SUPABASE_URL = origin;
  });
});
