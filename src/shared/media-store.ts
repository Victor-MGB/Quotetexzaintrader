import { isProd } from "../core/config.js";
import { logger } from "../core/logger.js";

/**
 * Testimony media lives in Supabase Storage rather than on the host's disk.
 *
 * The reason is that a Render service has an ephemeral filesystem: a file
 * written into the container is gone after the next deploy, while the database
 * still points at it. That is not a theoretical risk, it is the behaviour that
 * made uploaded pictures vanish from published cards.
 *
 * Written against the Storage REST API with fetch rather than the SDK, because
 * this project has no Supabase dependency and adding one for four calls would
 * be a large install for a small surface.
 *
 * The bucket is private. A member's upload becomes reachable the moment it is
 * written, long before an admin has approved it, and generated names are
 * sequential, so a public bucket would let anyone walk photo-9.jpeg, photo-10
 * and find unreviewed uploads. Cards are served a short-lived signed URL
 * instead, which Telegram fetches directly and the browser never sees.
 */

const BUCKET = "testimony-media";

/** Long enough for Telegram to fetch a card's media, short enough to not be a durable link. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const CONTENT_TYPES: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

function projectUrl(): string | null {
  const value = process.env.SUPABASE_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

function serviceKey(): string | null {
  return process.env.SUPABASE_SERVICE_KEY?.trim() || null;
}

/**
 * Whether uploads can be stored durably. Both halves are required: the URL tells
 * us where, the service key is what lets the bot write. An anon key would be
 * rejected by the bucket's write policy, so a half-configured setup is treated
 * as not configured rather than failing later on every upload.
 */
export function storageEnabled(): boolean {
  return projectUrl() !== null && serviceKey() !== null;
}

export function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const url = projectUrl();
  const key = serviceKey();

  if (!url || !key) {
    throw new Error("Media storage is not configured on this server.");
  }

  return fetch(`${url}/storage/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      ...(init.headers ?? {}),
    },
  });
}

let bucketChecked = false;

/**
 * Creates the bucket on first use so setting up storage is one environment
 * variable rather than a dashboard trip. A bucket that already exists answers
 * with a 400, which is not a problem worth surfacing.
 */
async function ensureBucket(): Promise<void> {
  if (bucketChecked) return;

  const response = await api("/bucket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 25_000_000 }),
  });

  if (!response.ok && response.status !== 400 && response.status !== 409) {
    const body = await response.text();
    throw new Error(`Could not prepare media storage (HTTP ${response.status}): ${body.slice(0, 200)}`);
  }

  bucketChecked = true;
  logger.info({ bucket: BUCKET }, "testimony media storage ready");
}

/**
 * Stores bytes under `key`. Refuses to overwrite: an existing key belongs to a
 * testimony that is already published and points at it.
 */
export async function putMedia(key: string, content: Buffer): Promise<void> {
  await ensureBucket();

  const response = await api(`/object/${BUCKET}/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      "Content-Type": contentTypeFor(key),
      "x-upsert": "false",
    },
    body: new Uint8Array(content),
  });

  if (!response.ok) {
    const body = await response.text();
    // 409 means the generated name collided, which the caller avoids by asking
    // for the next free number first.
    if (response.status === 409) {
      throw new Error("A file with that name already exists.");
    }
    throw new Error(`Storage rejected the upload (HTTP ${response.status}): ${body.slice(0, 200)}`);
  }
}

interface StorageEntry {
  name: string;
}

/** Every key currently in the bucket, used to pick a number that is free. */
export async function listMedia(): Promise<string[]> {
  await ensureBucket();

  const response = await api(`/object/list/${BUCKET}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // prefix is required by the API and an empty string means the whole bucket.
    // Omitting it answers 400, which would read as an empty bucket and hand out
    // a filename that is already taken.
    body: JSON.stringify({ prefix: "", limit: 1000 }),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, "could not list media storage; assuming it is empty");
    return [];
  }

  const body = (await response.json()) as StorageEntry[];
  return body.map((entry) => entry.name);
}

/**
 * A temporary URL Telegram can fetch. Expires quickly, so it is never something
 * to store or show to a member.
 */
export async function signedMediaUrl(key: string): Promise<string | null> {
  const response = await api(`/object/sign/${BUCKET}/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
  });

  if (!response.ok) return null;

  const { signedURL } = (await response.json()) as { signedURL?: string };
  if (!signedURL) return null;

  return `${projectUrl()}/storage/v1${signedURL}`;
}

/**
 * Whether media should be written to disk instead of storage.
 *
 * Only ever true outside production. A production bot with storage
 * unconfigured must fail loudly rather than quietly writing uploads to a
 * container that will delete them, because that is the exact failure this
 * module exists to remove.
 */
export function mayUseDisk(): boolean {
  return !isProd;
}

export { BUCKET as MEDIA_BUCKET };
