import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * The absolute path to send, or null when the file has since been deleted from
 * the folder. Callers treat null as "render this one without media" so a missing
 * file costs the picture, not the testimony.
 */
export function mediaPath(key: string | null | undefined): string | null {
  if (!key) return null;

  const item = MEDIA_LIBRARY.find((entry) => entry.key === key);
  if (!item) return null;

  const dir = item.kind === "photo" ? PHOTO_DIR : VIDEO_DIR;
  if (!dir) return null;

  const full = path.join(dir, item.key);
  return fs.existsSync(full) ? full : null;
}

export function mediaByKey(key: string | null | undefined): MediaItem | null {
  if (!key) return null;
  return MEDIA_LIBRARY.find((entry) => entry.key === key) ?? null;
}

/** How the media should be described under a card, or null when there is none. */
export function mediaCaptionTag(key: string | null | undefined): string | null {
  const item = mediaByKey(key);
  if (!item) return null;
  return item.kind === "photo" ? "🖼 Photo" : "🎬 Video";
}
