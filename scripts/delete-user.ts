/**
 * Removes a member from the database from the command line.
 *
 * The bot already knows how to delete someone — `/deleteuser <id>` calls
 * purgeMember, which drops the account row plus their transactions, referrals,
 * testimonies, whitelist entry, admin promotion and pending access request in a
 * single transaction. This is the same code path, for the times an id needs
 * removing without an admin sitting in front of the bot: a compromised account,
 * a test account, a data removal request.
 *
 * It talks to whatever DATABASE_URL is in the environment, which for this repo is
 * production, so the safe default has to be refusal rather than trust. Any host
 * that is not loopback stops the script unless --force-remote is passed, and the
 * host is printed before anything is deleted. It also prints the account it found
 * and asks for confirmation, because there is no undo.
 *
 *   npm run delete-user -- 6719294008
 *   npm run delete-user -- 6719294008 --yes             # no prompt
 *   npm run delete-user -- 6719294008 --notify          # also DM them
 *   npm run delete-user -- 6719294008 --force-remote    # allow a remote host
 */
// Loaded here, as the first thing the script does, so the host guard below can
// actually see DATABASE_URL. The app's own config also imports dotenv, but that is
// deferred behind the guard, which would otherwise read an empty environment and
// refuse every run — including the local ones it is supposed to allow.
import "dotenv/config";
import { LOOPBACK_DB_HOSTS, databaseHost } from "../src/shared/database-target.js";

/**
 * Everything that opens the database is imported after the host guard below, not
 * at the top of the file. Importing those modules builds a postgres pool from
 * DATABASE_URL and postgres parses the URL eagerly, so a malformed target would
 * throw during module evaluation, before the guard could refuse it. Deferring them
 * keeps the guard genuinely first.
 */

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const id = positional[0];
if (!id || !/^\d+$/.test(id)) {
  console.error("Usage: npm run delete-user -- <telegram-id> [--yes] [--notify] [--force-remote]");
  process.exit(1);
}

const assumedYes = flags.has("--yes");
const notify = flags.has("--notify");
const forceRemote = flags.has("--force-remote");

// The host is read before the first query, because findUserByTelegramId below is
// already a read against the target. .env points at production, so an unguarded
// run would reach across the internet to delete from the live database — which is
// a mistake this script has made once and must never make again.
const host = databaseHost(process.env.DATABASE_URL);
if (host === null) {
  console.error("DATABASE_URL is missing or not a valid URL. Refusing to run.");
  process.exit(1);
}

if (!LOOPBACK_DB_HOSTS.has(host) && !forceRemote) {
  console.error(
    `Refusing to delete from ${host}: that is not a local database, and this script deletes rows with no undo.`,
  );
  console.error(
    "If you truly mean to target a remote database, pass --force-remote as well.",
  );
  process.exit(1);
}

console.log(`Target database: ${host}${LOOPBACK_DB_HOSTS.has(host) ? " (local)" : " (REMOTE)"}`);

// Past the guard, so the pool is safe to build now.
const { findUserByTelegramId } = await import("../src/modules/auth/users.js");
const { purgeMember } = await import("../src/modules/admin/purge.js");
const { isPermanentAdmin } = await import("../src/modules/admin/store.js");

const user = await findUserByTelegramId(id);
if (!user) {
  // There may still be rows against this id even with no account: a previous
  // delete that only half-succeeded, or an access request from someone who never
  // registered. Purge sweeps by id, so it is asked to run anyway and will report
  // "nothing at all is recorded" if this really is an id with no history.
  console.log(`No account row for Telegram ID ${id}. Sweeping anything left against that id anyway.`);
}

if (user) {
  console.log("About to delete:");
  console.log(`  id       #${user.id}`);
  console.log(`  telegram ${user.telegramId}`);
  console.log(`  username ${user.username ?? "-"}`);
  console.log(`  name     ${[user.firstName, user.lastName].filter(Boolean).join(" ") || "-"}`);
  console.log(`  email    ${user.email ?? "-"}`);
  console.log(`  balance  ${user.balance}`);
  console.log(`  joined   ${user.createdAt.toISOString()}`);
}

if (!assumedYes) {
  const answer = process.stdin.isTTY ? await ask() : "n";
  if (answer !== "y") {
    console.log("Cancelled. Nothing was deleted.");
    process.exit(0);
  }
}

const purged = await purgeMember(id, { notify });
if (!purged) {
  // purgeMember refuses one case only: a permanent ADMIN_IDS admin, whose access
  // is environment config rather than a row, so deleting rows cannot take it away.
  // A runtime promotion is a row and is swept along with the account, which means
  // anything reaching this point is a permanent admin — and "demote first" would
  // be advice nobody could follow, because a permanent admin cannot be demoted.
  //
  // isPermanentAdmin reads ADMIN_IDS alone, so unlike isAdmin it is correct here
  // without loadAccess() having been called. The script never starts the bot, so
  // the in-memory mirror of the admins table is empty and isAdmin would quietly
  // answer for ADMIN_IDS only.
  console.error(
    isPermanentAdmin(id)
      ? `Nothing was deleted for ${id}. They are a permanent admin in ADMIN_IDS, so deleting rows cannot remove their access. Remove them from ADMIN_IDS and restart, then run this again.`
      : `Nothing at all is recorded for ${id}: no account, transactions, referrals, testimonies or requests.`,
  );
  process.exit(1);
}

console.log(
  purged.user
    ? `\nDeleted account #${purged.user.id} (${purged.user.telegramId}).`
    : `\nNo account row was left for ${id}; removed the remaining rows.`,
);
console.log(`  transactions    ${purged.transactions}`);
console.log(`  referrals       ${purged.referrals}`);
console.log(`  testimonies     ${purged.testimonies}`);
console.log(`  access requests ${purged.accessRequests}`);
console.log(`  access grants   ${purged.whitelist}`);
console.log(`  admin rows      ${purged.adminPromotions}`);
console.log("  bot access and the login session were ended too.");
if (!notify) {
  console.log("  the member was not told (pass --notify to DM them).");
} else if (purged.notified === false) {
  // A blocked bot rejects the send, and a script that said "the member was told"
  // would be reporting an intention rather than an outcome.
  console.log("  ⚠ the member was NOT told — the message could not be delivered, they may have blocked the bot.");
} else {
  console.log("  the member was told.");
}

const { db } = await import("../src/core/db.js");
await db.$client.end();
process.exit(0);

async function ask(): Promise<string> {
  process.stdout.write("\nType 'y' to confirm: ");
  const answer = await new Promise<string>((resolve) => {
    process.stdin.once("data", (chunk: Buffer | string) => resolve(chunk.toString().trim().toLowerCase()));
    process.stdin.resume();
  });
  return answer;
}
