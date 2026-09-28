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
 * It talks to whatever DATABASE_URL is in the environment, so it is only as safe
 * as that. It prints the account it found before deleting anything, and asks for
 * confirmation, because there is no undo.
 *
 *   npm run delete-user -- 6719294008
 *   npm run delete-user -- 6719294008 --yes      # no prompt
 *   npm run delete-user -- 6719294008 --notify   # also DM them
 */
import { db } from "../src/core/db.js";
import { logger } from "../src/core/logger.js";
import { isAdmin } from "../src/modules/admin/store.js";
import { purgeMember } from "../src/modules/admin/purge.js";
import { findUserByTelegramId } from "../src/modules/auth/users.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const id = positional[0];
if (!id || !/^\d+$/.test(id)) {
  console.error("Usage: npm run delete-user -- <telegram-id> [--yes] [--notify]");
  process.exit(1);
}

const assumedYes = flags.has("--yes");
const notify = flags.has("--notify");

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
  // purgeMember refuses admins, because their access lives in ADMIN_IDS and the
  // admins table rather than in the account row. Everything else reaching this
  // point means no table had a row for this id at all.
  console.error(
    isAdmin(id)
      ? `Nothing was deleted for ${id}. They are an admin — demote first, then delete the account.`
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
console.log(notify ? "  the member was told." : "  the member was not told (pass --notify to DM them).");

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
