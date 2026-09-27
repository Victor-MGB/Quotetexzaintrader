import { TEST_ADMIN_ID, TEST_DATABASE_URL } from "./config.js";

/**
 * config.ts validates the environment at import time and calls process.exit(1)
 * on anything missing, so the suite has to be able to load the app's modules
 * without a real .env. Placeholders are supplied here instead.
 *
 * Every value is defaulted, never overridden: anything already in the
 * environment wins. Combined with dotenv not overwriting existing variables,
 * this means the throwaway database takes precedence over the .env that points
 * at production, rather than the other way round.
 */
export function ensureTestEnv(): void {
  process.env.DATABASE_URL ??= TEST_DATABASE_URL;
  process.env.DB_SSL ??= "false";
  process.env.BOT_TOKEN ??= "0:test-token-never-sent";
  process.env.ADMIN_IDS ??= TEST_ADMIN_ID;
  process.env.NODE_ENV ??= "test";
  process.env.LOG_LEVEL ??= "silent";
  process.env.SESSION_TIMEOUT_MINUTES ??= "30";
}
