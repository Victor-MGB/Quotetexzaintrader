import { NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";

const buckets = new Map<number, { count: number; resetAt: number }>();

const LIMIT = 10;
const WINDOW_MS = 1000;
const MESSAGE = "Too many requests. Please slow down.";

export async function rateLimit(ctx: AppContext, next: NextFunction): Promise<void> {
  const now = Date.now();
  let bucket = buckets.get(ctx.from?.id ?? 0);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ctx.from?.id ?? 0, bucket);
  }

  bucket.count += 1;

  if (bucket.count > LIMIT) {
    await ctx.reply(MESSAGE).catch(() => {});
    return;
  }

  await next();
}

export function clearBuckets(): void {
  buckets.clear();
}