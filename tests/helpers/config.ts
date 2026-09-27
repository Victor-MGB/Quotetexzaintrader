import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../..");
const CONFIG_FILE = resolve(REPO_ROOT, "scripts/test-db.env");

/**
 * The throwaway database's settings live in scripts/test-db.env so that the
 * shell script that starts the container and the TypeScript that connects to it
 * read the same numbers. Nothing here is a secret: it is a local-only container
 * with a disposable password.
 */
function readConfig(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(CONFIG_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) throw new Error(`${CONFIG_FILE}: cannot parse "${trimmed}"`);
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const config = readConfig();

function required(key: string): string {
  const value = config[key];
  if (!value) throw new Error(`${key} is missing from scripts/test-db.env`);
  return value;
}

export const testDb = {
  host: required("QZT_TEST_DB_HOST"),
  port: Number(required("QZT_TEST_DB_PORT")),
  database: required("QZT_TEST_DB_NAME"),
  user: required("QZT_TEST_DB_USER"),
  password: required("QZT_TEST_DB_PASSWORD"),
  container: required("QZT_TEST_DB_CONTAINER"),
  image: required("QZT_TEST_DB_IMAGE"),
} as const;

export const TEST_DATABASE_URL = `postgresql://${testDb.user}:${testDb.password}@${testDb.host}:${testDb.port}/${testDb.database}`;

/**
 * Loopback aliases that count as "not production" no matter what the config
 * says. A test database is only ever reached over these.
 */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  testDb.host,
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  testDb.container,
]);

/**
 * Synthetic Telegram IDs. These are deliberately not anyone's real account:
 * a test should never be able to address, or look up, a real user.
 */
export const TEST_ADMIN_ID = "1000000001";
export const TEST_MEMBER_ID = "1000000002";
export const TEST_STRANGER_ID = "1000000003";

/** The opening balance for the withdrawal guard, and the amounts it tries. */
export const GUARD = {
  openingBalance: 250,
  affordable: 200,
  exact: 250,
  twiceAffordable: 400,
  tinyAffordable: 100,
  reducedBalance: 100,
  deposit: 500,
  /** The original exploit: an order of magnitude past the balance. */
  unaffordable: 10_000,
  /** Deliberately past what the balance ever holds here, to force a refusal. */
  overdrafted: 900,
} as const;

/**
 * Balances the tests expect afterwards, derived rather than typed in twice — a
 * changed opening balance cannot leave a stale literal in an assertion.
 */
export const EXPECTED = {
  untouched: GUARD.openingBalance,
  afterAffordable: GUARD.openingBalance - GUARD.affordable,
  afterTinyAffordable: GUARD.openingBalance - GUARD.tinyAffordable,
  afterReduced: GUARD.reducedBalance,
  afterDeposit: GUARD.openingBalance + GUARD.deposit,
  empty: 0,
} as const;

/** Telegram rejects a sendPhoto that is not a file, so a placeholder suffices. */
export const TEST_WALLET_ADDRESS = "0xtestwallet";
