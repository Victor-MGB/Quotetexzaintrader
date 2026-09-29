/**
 * Where a database is allowed to live before destructive code will touch it.
 *
 * Two callers delete rows — the test suites and scripts/delete-user.ts — and both
 * load a `.env` whose DATABASE_URL points at production. Each one therefore has to
 * prove the target is disposable before it runs a statement. That proof is the same
 * in both, so the loopback list lives here rather than being spelled out twice and
 * drifting: a new local alias added to one and forgotten in the other would be a
 * guard that only looks like a guard.
 *
 * This module deliberately imports nothing. It is read by tests/helpers/config.ts,
 * which runs before the app's own config so the throwaway URL can win over .env,
 * and pulling in config.ts here would validate the environment too early.
 */

/** Hosts that are this machine, and so can only ever be a throwaway database. */
export const LOOPBACK_DB_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/** The hostname of a database URL, or null when there is no usable URL. */
export function databaseHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
