import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "./config.js";
import { logger } from "./logger.js";

export const sql = postgres(env.DATABASE_URL, {
  max_lifetime: 60 * 30,
  ssl: env.DB_SSL === "true" ? "require" : false,
});

export const db = drizzle(sql);

export async function checkDb(): Promise<void> {
  await sql`select 1`;
  logger.info("database connection ok");
}