import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  BOT_USERNAME: z.string().optional(),
  BOT_MODE: z.enum(["webhook", "polling"]).default("polling"),
  BOT_WEBHOOK_URL: z.string().url().optional(),
  BOT_WEBHOOK_PATH: z.string().default("/webhook"),
  BOT_WEBHOOK_PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),
  DB_SSL: z.enum(["true", "false"]).default("false"),
  REDIS_URL: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  ADMIN_IDS: z.string().default(""),
  SESSION_TIMEOUT_MINUTES: z.coerce.number().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const adminIds = env.ADMIN_IDS.split(",").map((s) => s.trim()).filter(Boolean);