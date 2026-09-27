import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listMedia, mayUseDisk, putMedia, signedMediaUrl, storageEnabled } from "./media-store.js";

export type MediaKind = "photo" | "video";

export interface MediaItem {
  key: string;
  kind: MediaKind;
  label: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The library folders sit next to the sources, so the compiled bundle in dist/
 * and the sources in src/ both need to find them from a different depth. Rather
 * than pin a depth that breaks the next time a folder moves, this walks up until
 * it finds the directory, and it looks for both `<root>/pictures` and
 * `<root>/src/pictures` so it works from either layout.
 */
function locate(dirName: string): string | null {
  let current = here;

  for (let depth = 0; depth < 6; depth += 1) {
    for (const candidate of [path.join(current, dirName), path.join(current, "src", dirName)]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }

  return null;
}

const PHOTO_DIR = locate("pictures");
const VIDEO_DIR = locate("videos");

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4"]);

/**
 * Plain string order would put test10 before test2, so the digits in the filename
 * are compared numerically. Photos are indexed by file name rather than by an
 * explicit list, which means dropping a new image into the folder makes it
 * available to the admin picker with no code change.
 */
export function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function scan(dir: string | null, kind: MediaKind, extensions: Set<string>): MediaItem[] {
  if (!dir) return [];

  const files = fs
    .readdirSync(dir)
    .filter((file) => !file.startsWith("."))
    .filter((file) => extensions.has(path.extname(file).toLowerCase()))
    .sort(naturalSort);

  return files.map((file, index) => ({
    key: file,
    kind,
    label: `${kind === "photo" ? "🖼 Photo" : "🎬 Video"} ${index + 1}`,
  }));
}

/** Every photo and video the admin picker can attach, photos first. */
export const MEDIA_LIBRARY: MediaItem[] = [
  ...scan(PHOTO_DIR, "photo", PHOTO_EXTENSIONS),
  ...scan(VIDEO_DIR, "video", VIDEO_EXTENSIONS),
];

/**
 * Re-scans the folders. An admin can upload a file while the process is running,
 * and MEDIA_LIBRARY was built once at import, so a newly written file would
 * otherwise be invisible to the picker and unresolvable for the card. Mutated in
 * place so existing readers keep working.
 */
export function refreshMediaLibrary(): void {
  const fresh = [...scan(PHOTO_DIR, "photo", PHOTO_EXTENSIONS), ...scan(VIDEO_DIR, "video", VIDEO_EXTENSIONS)];
  MEDIA_LIBRARY.splice(0, MEDIA_LIBRARY.length, ...fresh);
}

/**
 * The absolute path to send, or null when the file has since been deleted from
 * the folder. Callers treat null as "render this one without media" so a missing
 * file costs the picture, not the testimony.
 *
 * Resolved from the filesystem rather than from the cached library, so a file
 * uploaded moments ago works before anything has rescanned.
 */
export function mediaPath(key: string | null | undefined): string | null {
  if (!key) return null;
  if (!isSafeKey(key)) return null;

  for (const dir of [PHOTO_DIR, VIDEO_DIR]) {
    if (!dir) continue;
    const full = path.join(dir, key);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }

  return null;
}

export function mediaByKey(key: string | null | undefined): MediaItem | null {
  if (!key || !isSafeKey(key)) return null;

  const known = MEDIA_LIBRARY.find((entry) => entry.key === key);
  if (known) return known;

  // Not in the cached library — an upload written since the last scan. The kind
  // comes from the extension, but only for a file that is actually on disk:
  // inferring from the extension alone would report a deleted photo as still
  // attached, and the admin preview would claim media that is not there.
  if (!mediaPath(key)) return null;

  const ext = path.extname(key).toLowerCase();
  if (PHOTO_EXTENSIONS.has(ext)) return { key, kind: "photo", label: "🖼 Photo" };
  if (VIDEO_EXTENSIONS.has(ext)) return { key, kind: "video", label: "🎬 Video" };
  return null;
}

/** How the media should be described under a card, or null when there is none. */
export function mediaCaptionTag(key: string | null | undefined): string | null {
  const item = mediaByKey(key);
  if (!item) return null;
  return item.kind === "photo" ? "🖼 Photo" : "🎬 Video";
}

/**
 * A media key arrives from the database and, for an upload, from a caption an
 * admin typed. It is joined onto a directory path, so anything able to climb out
 * of it — separators, "..", a leading slash, an absolute Windows path — has to be
 * refused rather than sanitised into something that looks safe.
 */
function isSafeKey(key: string): boolean {
  if (key !== path.basename(key)) return false;
  if (key === "." || key === ".." || key.startsWith(".")) return false;
  if (key.includes("/") || key.includes("\\") || key.includes("\0")) return false;
  return /^[A-Za-z0-9._-]+$/.test(key);
}

const MAX_STEM = 40;

function dirFor(kind: MediaKind): string {
  const dir = kind === "photo" ? PHOTO_DIR : VIDEO_DIR;
  if (!dir) throw new Error(`the ${kind} folder could not be found next to the code`);
  return dir;
}

/**
 * Turns whatever the admin typed into a filename that is safe to write. The
 * extension is taken from the file itself and never from the admin, so a caption
 * cannot decide what kind of file lands on disk.
 */
export function safeStem(desired: string | null | undefined, fallback: string): string {
  const raw = (desired ?? "")
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+$/, "")
    .slice(0, MAX_STEM);

  return raw.length > 0 ? raw : fallback;
}

function readDir(kind: MediaKind): string[] | null {
  const dir = kind === "photo" ? PHOTO_DIR : VIDEO_DIR;
  return dir ? fs.readdirSync(dir) : null;
}

/** photo-8 for the eighth photo, video-4 for the fourth, and so on. */
async function nextAutoStem(kind: MediaKind): Promise<string> {
  const prefix = kind === "photo" ? "photo" : "video";
  const pattern = new RegExp(`^${prefix}-(\\d+)\\.`);

  let highest = 0;
  for (const file of readDir(kind) ?? []) {
    const match = pattern.exec(file);
    if (match) highest = Math.max(highest, Number(match[1]));
  }

  // Uploads live in storage rather than on disk, so the count has to span both
  // or a restart would hand out photo-8 again and collide with a published card.
  if (storageEnabled()) {
    for (const name of await listMedia().catch(() => [])) {
      const match = pattern.exec(name);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }

  return `${prefix}-${highest + 1}`;
}

/**
 * Writes an uploaded photo or video into the same library the picker reads, then
 * rescans so the new file shows up. Returns the stored filename, which is what
 * goes in the database.
 */
/**
 * Picks a name that is not taken, checking both the disk and storage so a
 * number is never reused across a migration.
 */
async function freeKey(kind: MediaKind, desiredName: string | null | undefined): Promise<string> {
  const stem = safeStem(desiredName, await nextAutoStem(kind));
  const extension = defaultExtension(kind);

  let taken: Set<string>;
  if (storageEnabled()) {
    taken = new Set([...(await listMedia().catch(() => [])), ...(readDir(kind) ?? [])]);
  } else {
    taken = new Set(readDir(kind) ?? []);
  }

  let candidate = `${stem}${extension}`;
  let counter = 2;
  // Never silently overwrite: an existing testimony points at that file.
  while (taken.has(candidate)) {
    candidate = `${stem}-${counter}${extension}`;
    counter += 1;
  }

  return candidate;
}

/** Writes to disk. Used outside production, and by the tests. */
export function saveMediaToDisk(content: Buffer, kind: MediaKind, key: string): string {
  fs.writeFileSync(path.join(dirFor(kind), key), content);
  refreshMediaLibrary();
  return key;
}

/**
 * Stores an uploaded photo or video and returns the key to record in the
 * database.
 *
 * In production this goes to Supabase Storage, because a Render container's
 * disk is wiped on the next deploy and the database would be left pointing at a
 * file that no longer exists — the reason a published card quietly lost its
 * picture. Storage not being configured is therefore an error, not a reason to
 * fall back to disk.
 */
export async function saveMedia(
  content: Buffer,
  kind: MediaKind,
  desiredName: string | null | undefined,
): Promise<string> {
  const key = await freeKey(kind, desiredName);

  if (storageEnabled()) {
    await putMedia(key, content);
    return key;
  }

  if (!mayUseDisk()) {
    throw new Error("Media storage is not configured on this server.");
  }

  return saveMediaToDisk(content, kind, key);
}

/**
 * The kind of a key, from the library label or failing that the extension, with
 * no claim about whether the file exists.
 *
 * Separate from mediaByKey on purpose. Uploads live in Supabase Storage, not on
 * this host's disk, so "is it in the library" and "what kind is it" stopped
 * being the same question: a storage upload is not in the library and not on
 * disk, but it is still a photo, and the card has to know that to send it.
 */
export function mediaKindFor(key: string | null | undefined): MediaKind | null {
  if (!key || !isSafeKey(key)) return null;

  const known = MEDIA_LIBRARY.find((entry) => entry.key === key);
  if (known) return known.kind;

  const ext = path.extname(key).toLowerCase();
  if (PHOTO_EXTENSIONS.has(ext)) return "photo";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

/**
 * Everything needed to send one piece of media, from wherever it happens to
 * live: a stream from disk for the files committed to the repository, or a
 * short-lived URL for an upload in storage.
 *
 * Disk is checked first so the committed library keeps working with no storage
 * configured at all.
 */
export async function mediaSource(key: string | null | undefined): Promise<MediaSource | null> {
  const kind = mediaKindFor(key);
  if (!kind || !key) return null;

  const local = mediaPath(key);
  if (local) return { kind, key, path: local };

  const url = await signedMediaUrl(key).catch(() => null);
  return url ? { kind, key, url } : null;
}

export interface MediaSource {
  kind: MediaKind;
  key: string;
  path?: string;
  url?: string;
}

function defaultExtension(kind: MediaKind): string {
  return kind === "photo" ? ".jpeg" : ".mp4";
}
