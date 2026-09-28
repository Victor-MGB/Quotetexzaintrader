import assert from "node:assert/strict";
import { and, eq, or } from "drizzle-orm";
import { ensureTestEnv } from "./helpers/env.js";

ensureTestEnv();

const { after, afterEach, before, beforeEach, describe, it } = await import("node:test");
const { dbSkipReason, assertSchema, closeDb } = await import("./helpers/db.js");
const { TEST_ADMIN_ID, TEST_MEMBER_ID, TEST_STRANGER_ID } = await import("./helpers/config.js");

const skip = await dbSkipReason();
const MEMBER = TEST_MEMBER_ID;
const STRANGER = TEST_STRANGER_ID;
/** A third party, present only so a purge cannot be seen to delete the whole table. */
const BYSTANDER = "1000000004";

/**
 * The real clock, kept so a fake one can be put back. Assigning a number to
 * Date.now instead would leave every later test in the file calling a number.
 */
const realDateNow = Date.now;

/**
 * Three fixes are guarded here, all of them about access rather than money:
 *
 *  - a deleted member must not keep a live session and must be asked to register
 *    again rather than carry on as before;
 *  - deleting someone must actually remove them, not leave transactions and
 *    referrals pointing at an id that is gone;
 *  - 30 minutes of silence must end a session, and the member must be told.
 */
describe("session access verdicts", () => {
  let session: typeof import("../src/modules/auth/session.js");

  before(async () => {
    session = await import("../src/modules/auth/session.js");
  });

  afterEach(() => {
    session.logout(MEMBER);
    session.logout(STRANGER);
  });

  it("lets an admin in whatever their session says", () => {
    assert.equal(session.accessVerdict(TEST_ADMIN_ID, false), "granted");
  });

  it("lets a member with an account and a live session in", () => {
    session.login(MEMBER);
    assert.equal(session.accessVerdict(MEMBER, true), "granted");
  });

  it("asks an account holder with no session to log in", () => {
    assert.equal(session.accessVerdict(MEMBER, true), "needs-login");
  });

  it("asks someone with no account to register", () => {
    assert.equal(session.accessVerdict(MEMBER, false), "needs-account");
  });

  it("asks a deleted member to register, session or not", () => {
    // The bug: /deleteuser removed the row, the session map did not, and the
    // deleted member carried on with every button working until a restart.
    session.login(MEMBER);
    assert.equal(session.accessVerdict(MEMBER, false), "needs-account");
  });
});

describe("inactivity ends a session", () => {
  let session: typeof import("../src/modules/auth/session.js");
  let realNow: number;
  let fakeNow: () => number;

  before(async () => {
    session = await import("../src/modules/auth/session.js");
  });

  beforeEach(() => {
    realNow = Date.now();
    fakeNow = () => realNow;
  });

  afterEach(() => {
    Date.now = realDateNow;
    session.logout(MEMBER);
  });

  const advance = (minutes: number): void => {
    const target = realNow + minutes * 60_000;
    fakeNow = () => target;
    Date.now = fakeNow;
  };

  it("keeps a session alive while it is being used", () => {
    session.login(MEMBER);
    advance(20);
    session.touch(MEMBER);
    advance(45);
    assert.equal(session.isLoggedIn(MEMBER), true, "activity pushed the expiry out");
  });

  it("expires after the configured 30 minutes of silence", () => {
    assert.equal(session.sessionTimeoutMinutes(), 30);
    session.login(MEMBER);
    advance(31);
    assert.equal(session.isLoggedIn(MEMBER), false);
  });

  it("reports an expired session once, so the member is told once", () => {
    session.login(MEMBER);
    advance(31);
    assert.deepEqual(session.expiredSessions(), [MEMBER]);
    assert.deepEqual(session.expiredSessions(), [MEMBER], "still reported until the caller drops it");

    session.logout(MEMBER);
    assert.deepEqual(session.expiredSessions(), [], "dropped, so it is not announced again");
  });

  it("leaves a session that is still within the window alone", () => {
    session.login(MEMBER);
    advance(29);
    assert.deepEqual(session.expiredSessions(), []);
  });
});

describe("expiry sweep tells the member", { skip: skip ?? false }, () => {
  let session: typeof import("../src/modules/auth/session.js");
  let watchdog: typeof import("../src/modules/auth/watchdog.js");
  let bot: typeof import("../src/core/bot.js")["bot"];
  let db: typeof import("../src/core/db.js")["db"];
  let schema: typeof import("../src/db/schema.js");
  let realNow: number;
  let sent: { chatId: unknown; text: string }[];
  /** Moved forward by the fake clock, so a session can be walked past its timeout. */
  let fakeNow: () => number;

  const at = (minutes: number): void => {
    const target = realNow + minutes * 60_000;
    fakeNow = () => target;
    Date.now = fakeNow;
  };

  before(async () => {
    session = await import("../src/modules/auth/session.js");
    watchdog = await import("../src/modules/auth/watchdog.js");
    ({ bot } = await import("../src/core/bot.js"));
    ({ db } = await import("../src/core/db.js"));
    schema = await import("../src/db/schema.js");
    await assertSchema();

    // The real API is swapped out so the sweep can be tested without a token or
    // a network. Everything up to the sendMessage call is the code under test.
    sent = [];
    fakeNow = () => realNow;
    bot.api.sendMessage = (async (chatId: number | string, text: string) => {
      sent.push({ chatId, text });
      return { message_id: 1, date: 0, chat: { id: Number(chatId), type: "private" } };
    }) as never;
  });

  beforeEach(async () => {
    sent.length = 0;
    realNow = Date.now();
    await db
      .insert(schema.users)
      .values({ telegramId: MEMBER, firstName: "Sweep", balance: 0 })
      .onConflictDoNothing({ target: schema.users.telegramId });
  });

  afterEach(async () => {
    Date.now = realDateNow;
    session.logout(MEMBER);
    await db.delete(schema.users).where(eq(schema.users.telegramId, MEMBER));
  });

  it("prompts a member whose session ran out to log in again", async () => {
    session.login(MEMBER);
    at(31);

    await watchdog.sweepExpiredSessions();

    assert.equal(sent.length, 1, "the member is told rather than left to find out by being refused");
    assert.equal(sent[0]?.chatId, MEMBER);
    assert.match(sent[0]?.text ?? "", /log in again/i);
    assert.equal(session.isLoggedIn(MEMBER), false, "and the session really is over");
  });

  it("says nothing to someone whose account no longer exists", async () => {
    // Nothing to log in to, so a "please log in" would be a dead end. They are
    // told to register when they next tap something.
    await db.delete(schema.users).where(eq(schema.users.telegramId, MEMBER));
    session.login(MEMBER);
    at(31);

    await watchdog.sweepExpiredSessions();

    assert.deepEqual(sent, []);
    assert.equal(session.isLoggedIn(MEMBER), false, "the dead session is still cleaned up");
  });
});

describe("deleting a member removes all of them", { skip: skip ?? false }, () => {
  let users: typeof import("../src/modules/auth/users.js");
  let db: typeof import("../src/core/db.js")["db"];
  let schema: typeof import("../src/db/schema.js");

  before(async () => {
    users = await import("../src/modules/auth/users.js");
    ({ db } = await import("../src/core/db.js"));
    schema = await import("../src/db/schema.js");
    await assertSchema();
  });

  beforeEach(async () => {
    await wipe();
  });

  after(async () => {
    await wipe();
  });

  async function wipe(): Promise<void> {
    const ids = [MEMBER, STRANGER, BYSTANDER];
    await db.delete(schema.transactions).where(or(...ids.map((id) => eq(schema.transactions.telegramId, id))));
    await db.delete(schema.referrals).where(
      or(...ids.flatMap((id) => [eq(schema.referrals.referrerId, id), eq(schema.referrals.inviteeId, id)])),
    );
    await db
      .delete(schema.testimonies)
      .where(or(...ids.map((id) => eq(schema.testimonies.submittedBy, id))));
    await db.delete(schema.accessRequests).where(
      or(...ids.map((id) => eq(schema.accessRequests.telegramId, id))),
    );
    await db.delete(schema.admins).where(or(...ids.map((id) => eq(schema.admins.telegramId, id))));
    await db.delete(schema.whitelist).where(or(...ids.map((id) => eq(schema.whitelist.telegramId, id))));
    await db.delete(schema.users).where(or(...ids.map((id) => eq(schema.users.telegramId, id))));
  }

  async function seed(): Promise<void> {
    await db.insert(schema.users).values([
      { telegramId: MEMBER, firstName: "Member", email: "member@example.test", balance: 900 },
      { telegramId: STRANGER, firstName: "Stranger", email: "stranger@example.test", balance: 0 },
      { telegramId: BYSTANDER, firstName: "Bystander", email: "bystander@example.test", balance: 0 },
    ]);

    await db.insert(schema.transactions).values([
      { telegramId: MEMBER, type: "deposit", status: "approved", amount: 1000 },
      { telegramId: MEMBER, type: "withdrawal", status: "pending", amount: 200, address: "0xabc" },
      { telegramId: STRANGER, type: "deposit", status: "approved", amount: 50 },
    ]);

    await db.insert(schema.referrals).values([
      // The member referred somebody.
      { referrerId: MEMBER, inviteeId: STRANGER },
      // Somebody referred the member, so their row has to go from this side too.
      { referrerId: BYSTANDER, inviteeId: MEMBER },
      // Unrelated traffic that must survive.
      { referrerId: STRANGER, inviteeId: BYSTANDER },
    ]);

    await db.insert(schema.testimonies).values([
      { name: "Member", message: "My payout arrived on time, thanks to everyone.", submittedBy: MEMBER },
      { name: "Stranger", message: "Support answered within the hour, which was great.", submittedBy: STRANGER },
    ]);

    await db.insert(schema.whitelist).values([{ telegramId: MEMBER }, { telegramId: STRANGER }]);
    await db.insert(schema.admins).values({ telegramId: MEMBER, addedBy: TEST_ADMIN_ID });
    await db.insert(schema.accessRequests).values({
      telegramId: MEMBER,
      firstName: "Member",
      status: "pending",
    });
  }

  /** Rows a query matched, so each table can be checked on its own terms. */
  const matched = async (query: Promise<unknown[]>): Promise<number> => (await query).length;

  it("returns null for an id that is not there", async () => {
    assert.equal(await users.deleteUser(MEMBER), null);
  });

  it("takes the account row with it", async () => {
    await seed();
    const purged = await users.deleteUser(MEMBER);

    assert.ok(purged, "the delete reports what it removed");
    assert.equal(purged.hadAccount, true);
    assert.equal(purged.user?.telegramId, MEMBER);
    assert.equal(await users.findUserByTelegramId(MEMBER), null);
  });

  it("finishes the job when the account row has already gone", async () => {
    // The half-failed delete this used to refuse: the user row is missing, so the
    // old code looked it up, found nothing, told the admin "no account" and left
    // every remaining row pointing at an id that was supposed to be gone.
    await seed();
    await db.delete(schema.users).where(eq(schema.users.telegramId, MEMBER));

    const purged = await users.deleteUser(MEMBER);

    assert.ok(purged, "leftovers are still worth deleting");
    assert.equal(purged.hadAccount, false);
    assert.equal(purged.user, null);
    assert.equal(purged.transactions, 2);
    assert.equal(purged.referrals, 2);
    assert.equal(purged.testimonies, 1);
    assert.equal(purged.accessRequests, 1);
    assert.equal(purged.whitelist, 1);

    const txns = db.select().from(schema.transactions).where(eq(schema.transactions.telegramId, MEMBER));
    const pending = db.select().from(schema.accessRequests).where(eq(schema.accessRequests.telegramId, MEMBER));
    assert.equal(await matched(txns), 0);
    assert.equal(await matched(pending), 0);
  });

  it("leaves no transaction, referral or testimony of theirs behind", async () => {
    await seed();
    const purged = await users.deleteUser(MEMBER);

    assert.equal(purged?.transactions, 2, "both the deposit and the pending withdrawal");
    assert.equal(purged?.referrals, 2, "the one they referred and the one that referred them");
    assert.equal(purged?.testimonies, 1);

    const txns = db.select().from(schema.transactions).where(eq(schema.transactions.telegramId, MEMBER));
    const refs = db
      .select()
      .from(schema.referrals)
      .where(or(eq(schema.referrals.referrerId, MEMBER), eq(schema.referrals.inviteeId, MEMBER)));
    const cards = db.select().from(schema.testimonies).where(eq(schema.testimonies.submittedBy, MEMBER));

    assert.equal(await matched(txns), 0);
    assert.equal(await matched(refs), 0);
    assert.equal(await matched(cards), 0);
  });

  it("leaves everybody else's rows exactly where they were", async () => {
    await seed();
    await users.deleteUser(MEMBER);

    const txns = db.select().from(schema.transactions).where(eq(schema.transactions.telegramId, STRANGER));
    const refs = db
      .select()
      .from(schema.referrals)
      .where(and(eq(schema.referrals.referrerId, STRANGER), eq(schema.referrals.inviteeId, BYSTANDER)));
    const cards = db.select().from(schema.testimonies).where(eq(schema.testimonies.submittedBy, STRANGER));
    const accounts = db.select().from(schema.users).where(eq(schema.users.telegramId, STRANGER));

    assert.equal(await matched(txns), 1);
    assert.equal(await matched(refs), 1);
    assert.equal(await matched(cards), 1);
    assert.equal(await matched(accounts), 1);
  });

  it("takes their bot access, admin promotion and pending request with them", async () => {
    await seed();
    await users.deleteUser(MEMBER);

    const allowed = db.select().from(schema.whitelist).where(eq(schema.whitelist.telegramId, MEMBER));
    const promoted = db.select().from(schema.admins).where(eq(schema.admins.telegramId, MEMBER));
    const pending = db.select().from(schema.accessRequests).where(eq(schema.accessRequests.telegramId, MEMBER));

    assert.equal(await matched(allowed), 0, "no bot access left behind");
    assert.equal(await matched(promoted), 0);
    assert.equal(await matched(pending), 0);
  });

  it("frees the email so the same person can register again", async () => {
    await seed();
    await users.deleteUser(MEMBER);

    const again = await users.createUser({
      telegramId: MEMBER,
      firstName: "Member",
      email: "member@example.test",
      passwordHash: "hash",
    });

    assert.ok(again, "the unique email index no longer holds a ghost of the deleted account");
  });

  it("leaves a deleted member with no account and so nothing to log in to", async () => {
    const session = await import("../src/modules/auth/session.js");
    await seed();
    session.login(MEMBER);

    await users.deleteUser(MEMBER);

    const account = await users.findUserByTelegramId(MEMBER);
    assert.equal(session.accessVerdict(MEMBER, account !== null), "needs-account");
  });
});

describe("a purge clears what this process remembers", { skip: skip ?? false }, () => {
  /** A synthetic referrer, so the attribution middleware has something to record. */
  const REFERRER = "1000000005";
  let purge: typeof import("../src/modules/admin/purge.js");
  let session: typeof import("../src/modules/auth/session.js");
  let store: typeof import("../src/modules/admin/store.js");
  let referrals: typeof import("../src/modules/referrals/index.js");
  let support: typeof import("../src/modules/support/index.js");
  let db: typeof import("../src/core/db.js")["db"];
  let schema: typeof import("../src/db/schema.js");
  let sent: { chatId: unknown; text: string }[];

  before(async () => {
    purge = await import("../src/modules/admin/purge.js");
    session = await import("../src/modules/auth/session.js");
    store = await import("../src/modules/admin/store.js");
    referrals = await import("../src/modules/referrals/index.js");
    support = await import("../src/modules/support/index.js");
    ({ db } = await import("../src/core/db.js"));
    schema = await import("../src/db/schema.js");
    const { bot } = await import("../src/core/bot.js");
    await assertSchema();

    sent = [];
    bot.api.sendMessage = (async (chatId: number | string, text: string) => {
      sent.push({ chatId, text });
      return { message_id: 1, date: 0, chat: { id: Number(chatId), type: "private" } };
    }) as never;
  });

  beforeEach(async () => {
    sent.length = 0;
    await db.delete(schema.users).where(eq(schema.users.telegramId, MEMBER));
    await db.delete(schema.whitelist).where(eq(schema.whitelist.telegramId, MEMBER));
  });

  after(async () => {
    await db.delete(schema.referrals).where(eq(schema.referrals.inviteeId, MEMBER));
  });

  afterEach(async () => {
    session.logout(MEMBER);
    support.forgetSupportState(MEMBER);
    await db.delete(schema.users).where(eq(schema.users.telegramId, MEMBER));
    await db.delete(schema.admins).where(eq(schema.admins.telegramId, MEMBER));
  });

  /** Puts the member in the state that used to survive a delete. */
  async function arm(): Promise<void> {
    await db.insert(schema.users).values({ telegramId: MEMBER, firstName: "Member", email: "m@example.test" });
    await db.insert(schema.whitelist).values({ telegramId: MEMBER }).onConflictDoNothing();
    await store.loadAccess();
    session.login(MEMBER);
  }

  it("ends the session and the bot access, not just the row", async () => {
    await arm();
    assert.equal(session.isLoggedIn(MEMBER), true);
    assert.equal(store.isAllowed(MEMBER), true);

    await purge.purgeMember(MEMBER, { notify: false });

    assert.equal(session.isLoggedIn(MEMBER), false, "the live session cannot outlive the account");
    assert.equal(store.isAllowed(MEMBER), false, "and neither can the cached whitelist entry");
    const accounts = await db.select().from(schema.users).where(eq(schema.users.telegramId, MEMBER));
    assert.equal(accounts.length, 0);
  });

  it("demotes a promoted admin instead of refusing to delete them", async () => {
    // The combination that made a deleted member untouchable: the account row was
    // already gone, so the delete reported "no account" and returned, while the
    // admins row kept granting every screen. A runtime promotion is a row, so it
    // goes as part of the delete.
    await db.insert(schema.users).values({ telegramId: MEMBER, firstName: "Member", email: "m@example.test" });
    await db
      .insert(schema.admins)
      .values({ telegramId: MEMBER, addedBy: TEST_ADMIN_ID })
      .onConflictDoNothing();
    await store.loadAccess();
    assert.equal(store.isAdmin(MEMBER), true, "the promotion is what grants access without an account");

    const purged = await purge.purgeMember(MEMBER, { notify: false });

    assert.ok(purged, "not a refusal");
    // The promotion is already gone by the time the sweep runs, because
    // demoting is what makes the rest of the delete possible.
    assert.equal(purged.adminPromotions, 0, "the demotion happened first, so the sweep found nothing left");
    assert.equal(purged.hadAccount, true);
    assert.equal(store.isAdmin(MEMBER), false, "and the access goes with it");

    const promoted = await db.select().from(schema.admins).where(eq(schema.admins.telegramId, MEMBER));
    assert.equal(promoted.length, 0);
  });

  it("still refuses a permanent admin, whose access is not a row", async () => {
    // The one case worth stopping for: ADMIN_IDS outlives every delete, so a
    // mis-click cannot be undone by removing rows.
    assert.equal(await purge.purgeMember(TEST_ADMIN_ID, { notify: false }), null);
  });

  it("tells the member to send /start rather than offering a button the gate refuses", async () => {
    await arm();

    await purge.purgeMember(MEMBER);

    assert.equal(sent.length, 1, "the member is not left guessing");
    const message = sent[0];
    assert.equal(message?.chatId, MEMBER);
    assert.match(message?.text ?? "", /\/start/, "the one route that actually works is named");
    assert.doesNotMatch(message?.text ?? "", /Register \/ Create Account/, "no dead button back into the gate");
  });

  it("clears a half-typed support message and referral note", async () => {
    await arm();

    // referralCapture is the only thing that sets the note, so it is driven
    // through its own middleware rather than reaching into the map.
    const capture = async (): Promise<void> => {
      await referrals.referralCapture(
        { from: { id: Number(MEMBER) }, msg: { text: `/start ref_${REFERRER}` } } as never,
        (async () => undefined) as never,
      );
    };

    await capture();
    assert.notEqual(referrals.consumeReferralNote(MEMBER), "", "the note was set, then read and cleared");

    await capture();
    support.beginSupport(MEMBER);

    await purge.purgeMember(MEMBER, { notify: false });

    assert.equal(referrals.consumeReferralNote(MEMBER), "", "no referral credit survives the account");
    assert.equal(support.isComposingSupport(MEMBER), false, "and no half-typed message either");
  });
});

describe("the welcome screen is not a door", () => {
  let welcomeText: typeof import("../src/modules/start/index.js")["welcomeText"];

  before(async () => {
    ({ welcomeText } = await import("../src/modules/start/index.js"));
  });

  it("says an admin has to approve you before you have access", () => {
    const text = welcomeText("Newcomer", false, "");

    assert.match(text, /Welcome to/);
    assert.match(text, /admin has to approve you first/i);
    assert.match(text, /Nothing in the bot opens until that happens/i);
  });

  it("does not tell an approved member they are still waiting", () => {
    const text = welcomeText("Member", true, "");

    assert.match(text, /Welcome to/);
    assert.doesNotMatch(text, /approve you first/i);
  });

  it("carries no main menu button in either case", () => {
    // The button is a reply_markup, not copy, so what is asserted here is that
    // the wording never points at a menu the welcome does not offer.
    for (const approved of [true, false]) {
      const text = welcomeText("Someone", approved, "");
      assert.doesNotMatch(text, /main menu/i);
    }
  });

  it("still surfaces a referral note when there is one", () => {
    const text = welcomeText("Newcomer", false, "\n\n👥 You joined through a referral link.");

    assert.match(text, /joined through a referral link/);
  });
});

describe("access requests are queued once and decided once", { skip: skip ?? false }, () => {
  let requests: typeof import("../src/modules/admin/requests.js");
  let db: typeof import("../src/core/db.js")["db"];
  let schema: typeof import("../src/db/schema.js");

  const who = { telegramId: STRANGER, firstName: "Stranger", lastName: "Member" };

  before(async () => {
    requests = await import("../src/modules/admin/requests.js");
    ({ db } = await import("../src/core/db.js"));
    schema = await import("../src/db/schema.js");
    await assertSchema();
  });

  beforeEach(async () => {
    await db.delete(schema.accessRequests).where(eq(schema.accessRequests.telegramId, STRANGER));
  });

  after(async () => {
    await db.delete(schema.accessRequests).where(eq(schema.accessRequests.telegramId, STRANGER));
  });

  it("records the first request and tells the admins about it", async () => {
    const outcome = await requests.requestAccess(who);

    assert.equal(outcome.firstTime, true);
    assert.equal(outcome.notify, true, "nobody has heard of this person yet");
    assert.equal(outcome.row.status, "pending");
    assert.equal(await requests.countPendingRequests(), 1);
  });

  it("does not re-notify while the request is still waiting", async () => {
    await requests.requestAccess(who);
    const again = await requests.requestAccess(who);

    assert.equal(again.firstTime, false);
    assert.equal(again.notify, false, "one ping, not one per tap");
    assert.equal(await requests.countPendingRequests(), 1, "and still only one row to decide");
  });

  it("pings the admins again once the cooldown has passed", async () => {
    await requests.requestAccess(who);
    await db
      .update(schema.accessRequests)
      .set({ notifiedAt: new Date(Date.now() - requests.NOTIFY_COOLDOWN_MS - 60_000) })
      .where(eq(schema.accessRequests.telegramId, STRANGER));

    const again = await requests.requestAccess(who);
    assert.equal(again.notify, true, "a member who is still waiting eventually gets chased");
  });

  it("records an approval with who made it", async () => {
    await requests.requestAccess(who);
    const decided = await requests.decideAccess(STRANGER, "approved", TEST_ADMIN_ID);

    assert.equal(decided?.status, "approved");
    assert.equal(decided?.decidedBy, TEST_ADMIN_ID);
    assert.ok(decided?.decidedAt);
    assert.equal(await requests.countPendingRequests(), 0);
  });

  it("refuses a second decision on the same request", async () => {
    await requests.requestAccess(who);
    await requests.decideAccess(STRANGER, "approved", TEST_ADMIN_ID);

    // Two admins tapping Approve and Reject at once: one wins, the other is told
    // it was already handled rather than overwriting the record.
    const second = await requests.decideAccess(STRANGER, "rejected", TEST_ADMIN_ID);
    assert.equal(second, null);
    assert.equal((await requests.findRequest(STRANGER))?.status, "approved");
  });

  it("lets a rejected member ask again", async () => {
    await requests.requestAccess(who);
    await requests.decideAccess(STRANGER, "rejected", TEST_ADMIN_ID);

    const again = await requests.requestAccess(who);

    assert.equal(again.previous, "rejected");
    assert.equal(again.row.status, "pending", "a fresh request, not a dead end");
    assert.equal(again.row.decidedBy, null, "and no longer tied to the old decision");
  });

  it("lists the queue newest first for the admin's request screen", async () => {
    await requests.requestAccess({ telegramId: "1000000009" });
    await db
      .update(schema.accessRequests)
      .set({ requestedAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(schema.accessRequests.telegramId, "1000000009"));
    await requests.requestAccess(who);

    const rows = await requests.listPendingRequests();
    assert.deepEqual(
      rows.map((r) => r.telegramId),
      [STRANGER, "1000000009"],
    );

    await db.delete(schema.accessRequests).where(eq(schema.accessRequests.telegramId, "1000000009"));
  });
});

after(async () => {
  await closeDb();
});
