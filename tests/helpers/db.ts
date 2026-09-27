import { LOCAL_HOSTS } from "./config.js";

/**
 * These suites write and delete rows, so pointing one at a real database would
 * be destructive. .env holds a production URL, and dotenv loads it, so every
 * database test has to prove the target is disposable before running a single
 * statement. A non-local host is refused outright unless the operator overrides
 * it, which is a deliberate speed bump rather than a suggestion.
 */
export async function dbSkipReason(): Promise<string | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return "DATABASE_URL is not set";

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return `DATABASE_URL is not a valid URL`;
  }

  if (!LOCAL_HOSTS.has(host) && process.env.QZT_TEST_ALLOW_REMOTE !== "true") {
    return `refusing to write to ${host} — these tests delete rows. Run "npm run test:db:up" for a throwaway database, or set QZT_TEST_ALLOW_REMOTE=true if you truly mean it.`;
  }

  // A local database that is simply not running is a skip, not a failure: the
  // card and rendering suites have no database dependency and must still pass.
  const { sql } = await import("../../src/core/db.js");
  try {
    await sql`select 1`;
  } catch (err) {
    return `no database reachable at ${url} (${(err as Error).message.split("\n")[0]})`;
  }

  return null;
}

/**
 * The app's postgres.js pool holds a socket open, which keeps the event loop
 * alive and stops the test runner's child process from ever exiting — the tests
 * would pass and then hang forever instead. Node 20 has no --test-force-exit, so
 * every file closes the pool when it is done. Safe to call when nothing ever
 * connected, which is what happens to a fully skipped file.
 */
export async function closeDb(): Promise<void> {
  const { sql } = await import("../../src/core/db.js");
  await sql.end({ timeout: 5 });
}

/** Every table a suite is allowed to empty. Users are deliberately absent. */
export async function clearTestimonies(): Promise<void> {
  const { db } = await import("../../src/core/db.js");
  const { testimonies } = await import("../../src/db/schema.js");
  await db.delete(testimonies);
}

/**
 * The migrations have to exist before a test can touch the table. Skipping with
 * a reason is friendlier than a raw Postgres error when the container is up but
 * `db:migrate` was never run against it. The table name is read from the schema
 * so a rename cannot leave this quietly checking the wrong thing.
 */
export async function assertSchema(): Promise<void> {
  const { sql } = await import("../../src/core/db.js");
  const { getTableName } = await import("drizzle-orm");
  const { testimonies } = await import("../../src/db/schema.js");

  const name = getTableName(testimonies);
  const rows = await sql`select to_regclass(${"public." + name}) as t`;

  if (!rows[0]?.t) {
    throw new Error(`the ${name} table is missing — run: npm run test:db:up`);
  }
}
