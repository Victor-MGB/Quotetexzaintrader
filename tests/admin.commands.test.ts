import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { Update } from "grammy/types";

/**
 * Guards the admin permission commands against being shadowed.
 *
 * The four admin commands that live in one module and the two that live in
 * another were all registered, all named correctly, and all reachable by every
 * other test in this suite — and none of them worked, because three middlewares
 * upstream claim a bare message first. A composer that answers a step of a draft
 * is registered ahead of the command composers, so while a draft was open every
 * one of /allow, /reject, /disallow, /promote, /demote and /deleteuser was
 * consumed as draft text and answered with the next step of the draft. The admin
 * saw the bot cheerfully publish their command as a testimony name.
 *
 * The two other faults covered here are the reason it stayed a mystery for so
 * long: a runtime promotion filed the admin under the member role, so the
 * commands were missing from their Telegram menu, and every refusal was silent,
 * so a command eaten by a composer was indistinguishable from a command that
 * had never been wired up at all.
 *
 * The composer order below is copied from src/index.ts, because the order is
 * the bug: a test that drove the composers in isolation would pass against the
 * code that shipped.
 */

const { ensureTestEnv } = await import("./helpers/env.js");
ensureTestEnv();

const { closeDb } = await import("./helpers/db.js");
const { Context } = await import("grammy");
const { bot } = await import("../src/core/bot.js");
const { adminIds } = await import("../src/core/config.js");
const { testimonyAdmin } = await import("../src/modules/admin/testimony.js");
const { admin } = await import("../src/modules/admin/index.js");
const { dash: adminDash } = await import("../src/modules/dashboard/admin.js");
const { testimony: memberTestimony } = await import("../src/modules/testimony/index.js");
const { auth } = await import("../src/modules/auth/index.js");
const { roleFor } = await import("../src/modules/menu.js");
const store = await import("../src/modules/admin/store.js");

// ensureTestEnv points ADMIN_IDS at a synthetic id, so the real one would fail
// the guard and every reply would be "Admins only".
const ADMIN_ID = Number(adminIds[0]);
const CHAT_ID = 4242;
/** A throwaway id used as the target of the commands, so no real row is touched. */
const TARGET = "1000000099";

interface Sent {
  text: string;
}

let sent: Sent[] = [];
let menus: { chatId: number; commands: { command: string }[] }[] = [];
/** Chat ids the stub refuses to deliver to, standing in for a blocked bot. */
let blocked = new Set<number>();

const api = {
  sendMessage(chatId: number | string, text: string) {
    // The module-level bot passes the telegram id as the string it is stored as,
    // while a context passes a number, so the set is compared numerically.
    if (blocked.has(Number(chatId))) {
      // Telegram's own answer when a member has blocked the bot. Swallowing this
      // is exactly the bug the delivery tests are here to catch.
      return Promise.reject(new Error("Forbidden: bot was blocked by the user"));
    }
    sent.push({ text });
    return Promise.resolve({ message_id: sent.length, chat: { id: Number(chatId), type: "private", first_name: "Patrick" }, date: 0 });
  },
  answerCallbackQuery() {
    return Promise.resolve(true);
  },
  editMessageText(_id: unknown, _chat: unknown, text: string) {
    sent.push({ text });
    return Promise.resolve(true);
  },
  editMessageReplyMarkup() {
    return Promise.resolve(true);
  },
};

const me = { id: 1, is_bot: true, first_name: "bot", username: "quotex_zain_bot" };

type Composer = { middleware: () => (c: unknown, n: () => Promise<void>) => Promise<void> };

/** The order in src/index.ts, and only the composers that can claim the message. */
const CHAIN: Composer[] = [
  auth as never as Composer,
  testimonyAdmin as never as Composer,
  memberTestimony as never as Composer,
  admin as never as Composer,
  adminDash as never as Composer,
];

async function run(update: Update): Promise<void> {
  const ctx = new Context(update as never, api as never, me as never);
  for (const composer of CHAIN) {
    let fellThrough = false;
    await composer.middleware()(ctx, async () => {
      fellThrough = true;
    });
    if (!fellThrough) return;
  }
}

function textUpdate(text: string, from = { id: ADMIN_ID, first_name: "Patrick" }): Update {
  return {
    update_id: sent.length + 1,
    message: {
      message_id: sent.length + 1,
      date: 0,
      chat: { id: CHAT_ID, type: "private", first_name: "Patrick" },
      from: { ...from, is_bot: false, username: "hhykto" },
      text,
      // grammy only treats text as a command when Telegram marked it as one, and
      // Telegram does mark a leading slash that way.
      entities: [{ type: "bot_command", offset: 0, length: (text.split(" ")[0] ?? "").length }],
    },
  };
}

function callbackUpdate(data: string, from = { id: ADMIN_ID, first_name: "Patrick" }): Update {
  return {
    update_id: sent.length + 1,
    callback_query: {
      id: String(sent.length + 1),
      from: { ...from, is_bot: false, first_name: "Patrick", username: "hhykto" },
      chat_instance: "x",
      data,
      message: {
        message_id: sent.length + 1,
        date: 0,
        chat: { id: CHAT_ID, type: "private", first_name: "Patrick" },
        text: "menu",
      },
    },
  };
}

const lastText = (): string => sent.at(-1)?.text ?? "";
const allText = (): string => sent.map((s) => s.text).join("\n");

/** The six commands, with the target they would act on. */
const COMMANDS = [
  "/allow",
  "/reject",
  "/disallow",
  "/deleteuser",
  "/promote",
  "/demote",
] as const;

describe("the admin permission commands", () => {
  beforeEach(async () => {
    sent = [];
    menus = [];
    // setMyCommands is the only outward call a menu change makes, and it is what
    // a promoted admin's command list is actually made of.
    (bot.api as unknown as { setMyCommands: unknown }).setMyCommands = (
      commands: { command: string }[],
      options?: { scope?: { chat_id?: number } },
    ) => {
      menus.push({ chatId: options?.scope?.chat_id ?? 0, commands });
      return Promise.resolve(true);
    };
    (bot.api as unknown as { setChatMenuButton: unknown }).setChatMenuButton = () => Promise.resolve(true);
    await store.disallowUser(TARGET);
  });

  it("answers every one of the six when nothing else is claiming the message", async () => {
    for (const command of COMMANDS) {
      sent = [];
      await run(textUpdate(`${command} ${TARGET}`));
      assert.notEqual(lastText(), "", `${command} was answered with silence`);
      assert.doesNotMatch(allText(), /Admins only/i, `${command} was refused to the admin running it`);
    }
  });

  it("still answers them all while an admin testimony draft is open", async () => {
    // The composer that used to eat them. A draft is left open for 15 minutes
    // after the admin walks away, so this is not an edge case.
    await run(callbackUpdate("tstadmin:new"));
    assert.match(lastText(), /step 1 of 4/i, "the draft should be open");

    for (const command of COMMANDS) {
      sent = [];
      await run(textUpdate(`${command} ${TARGET}`));

      assert.notEqual(lastText(), "", `${command} was swallowed by the open draft`);
      assert.doesNotMatch(
        allText(),
        /Name: <b>\//i,
        `${command} was published as the testimony name instead of running`,
      );
    }
  });

  it("still answers them all mid-draft, once the name step is done", async () => {
    await run(callbackUpdate("tstadmin:new"));
    await run(textUpdate("Sarah Okonkwo"));
    assert.match(lastText(), /step 2 of 4/i);

    for (const command of COMMANDS) {
      sent = [];
      await run(textUpdate(`${command} ${TARGET}`));
      assert.notEqual(lastText(), "", `${command} was swallowed mid-draft`);
      assert.doesNotMatch(allText(), /Name: <b>\//i, `${command} became a name mid-draft`);
    }
  });

  it("leaves a member's own draft open when they type a command instead", async () => {
    const member = { id: 424242, first_name: "Member" };
    await run(callbackUpdate("tst:share", member));
    await run(callbackUpdate("tst:name_anon", member));

    sent = [];
    await run(textUpdate("/menu", member));
    assert.doesNotMatch(allText(), /Sent\. An admin has been notified/i, "/menu was published as a testimony");

    // The draft must survive, or the command cost the member their testimony.
    sent = [];
    await run(textUpdate("My first payout landed in about two days.", member));
    assert.match(lastText(), /Sent\. An admin has been notified/i, "the draft was thrown away by a command");
  });

  it("tells a stranger why nothing happened instead of going quiet", async () => {
    sent = [];
    await run(textUpdate(`/allow ${TARGET}`, { id: 777777, first_name: "Nobody" }));
    assert.match(allText(), /Admins only/i, "a refused admin command must say so");
  });

  it("files a runtime promotion as an admin, not as a member", async () => {
    assert.equal(roleFor(TARGET), "restricted", "precondition: not an admin yet");

    await run(textUpdate(`/promote ${TARGET}`));
    assert.equal(store.isAdmin(TARGET), true, "precondition: the promotion took");

    // This is the whole point of the menu push in /promote.
    assert.equal(roleFor(TARGET), "admin", "a promoted admin was filed as a member or a stranger");
    const pushed = menus.at(-1);
    assert.equal(pushed?.chatId, Number(TARGET), "the menu was pushed to the wrong chat");

    await store.demoteAdmin(TARGET);
  });

  it("gives a promoted admin the full command list, not the member one", async () => {
    sent = [];
    menus = [];
    await run(textUpdate(`/promote ${TARGET}`));

    const names = menus.at(-1)?.commands.map((c) => c.command) ?? [];
    for (const command of COMMANDS) {
      assert.ok(names.includes(command.slice(1)), `${command} is missing from the promoted admin's menu`);
    }

    await store.demoteAdmin(TARGET);
  });

  it("takes the admin list away again on demote", async () => {
    await store.promoteAdmin(TARGET, String(ADMIN_ID));
    assert.equal(roleFor(TARGET), "admin");

    menus = [];
    sent = [];
    await run(textUpdate(`/demote ${TARGET}`));
    assert.equal(store.isAdmin(TARGET), false, "precondition: the demotion took");

    const names = menus.at(-1)?.commands.map((c) => c.command) ?? [];
    for (const command of COMMANDS) {
      assert.ok(!names.includes(command.slice(1)), `${command} survived the demotion`);
    }
  });
});

describe("the admin permission commands say what they actually did", () => {
  beforeEach(async () => {
    sent = [];
    menus = [];
    (bot.api as unknown as { setMyCommands: unknown }).setMyCommands = (
      commands: { command: string }[],
      options?: { scope?: { chat_id?: number } },
    ) => {
      menus.push({ chatId: options?.scope?.chat_id ?? 0, commands });
      return Promise.resolve(true);
    };
    (bot.api as unknown as { setChatMenuButton: unknown }).setChatMenuButton = () => Promise.resolve(true);
    const { db } = await import("../src/core/db.js");
    const schema = await import("../src/db/schema.js");
    await db.delete(schema.accessRequests).where(eq(schema.accessRequests.telegramId, TARGET));
    await db.delete(schema.users).where(eq(schema.users.telegramId, TARGET));
    await db.delete(schema.admins).where(eq(schema.admins.telegramId, TARGET));
    await store.loadAccess();
  });

  it("does not claim a request was already decided when nobody ever asked", async () => {
    // The lie this replaces: an admin allowing somebody proactively was told
    // "already decided" and had no way to tell the approval had in fact landed.
    sent = [];
    await run(textUpdate(`/allow ${TARGET}`));

    assert.match(allText(), /allowed/i, "the admin is not told the decision pre-dates them");
    assert.doesNotMatch(allText(), /already decided/i);
    assert.equal(store.isAllowed(TARGET), true, "and the access really was granted");
  });

  it("still calls a second decision on the same request a repeat", async () => {
    const { requestAccess } = await import("../src/modules/admin/requests.js");
    await requestAccess({ telegramId: TARGET });

    sent = [];
    await run(textUpdate(`/allow ${TARGET}`));
    assert.match(allText(), /now allowed/i, "the first decision is a fresh one");

    sent = [];
    await run(textUpdate(`/allow ${TARGET}`));
    assert.match(allText(), /already decided/i, "the second is not");
    assert.doesNotMatch(allText(), /now allowed/i);
  });

  it("refuses to disallow a promoted admin and says which command will work", async () => {
    await store.promoteAdmin(TARGET, String(ADMIN_ID));

    sent = [];
    await run(textUpdate(`/disallow ${TARGET}`));

    assert.match(allText(), /\/demote/i, "the admin is pointed at the command that does work");
    assert.match(allText(), /admin/i);
    assert.equal(store.isAdmin(TARGET), true, "the promotion is untouched");
  });

  it("refuses to disallow a permanent admin, whose access is not a row", async () => {
    sent = [];
    await run(textUpdate(`/disallow ${adminIds[0]}`));
    assert.match(allText(), /ADMIN_IDS/i);
  });

  it("takes a pending request off the queue when access is revoked", async () => {
    const { requestAccess, countPendingRequests } = await import("../src/modules/admin/requests.js");
    await requestAccess({ telegramId: TARGET });
    assert.equal(await countPendingRequests(), 1, "precondition: they are waiting");

    sent = [];
    await run(textUpdate(`/disallow ${TARGET}`));

    assert.equal(await countPendingRequests(), 0, "the stale Approve button is gone, so it cannot re-grant");
    assert.equal(store.isAllowed(TARGET), false, "and the access really was revoked");
  });

  it("counts the admin promotion a delete removed", async () => {
    const { db } = await import("../src/core/db.js");
    const schema = await import("../src/db/schema.js");
    await db.insert(schema.users).values({ telegramId: TARGET, firstName: "Target" });
    await db.insert(schema.admins).values({ telegramId: TARGET, addedBy: String(ADMIN_ID) });
    await store.loadAccess();

    sent = [];
    await run(textUpdate(`/deleteuser ${TARGET}`));

    assert.match(allText(), /1 admin promotion/i, "the count has to reflect the promotion that was removed");
  });
});

/**
 * "Has been told" is a claim about the world, not about intent.
 *
 * A member who has blocked the bot cannot be told anything, and an admin who
 * deletes someone and is then told "They have been told" has no way to know
 * otherwise. The decision is durable either way, so the honest report is that
 * the change is saved and the delivery failed — not silence, and not a
 * confirmation that did not happen.
 */
describe("delivery failures are reported rather than glossed over", () => {
  beforeEach(async () => {
    sent = [];
    menus = [];
    blocked = new Set([Number(TARGET)]);
    (bot.api as unknown as { setMyCommands: unknown }).setMyCommands = () => Promise.resolve(true);
    (bot.api as unknown as { setChatMenuButton: unknown }).setChatMenuButton = () => Promise.resolve(true);
    // The module-level bot is the real grammy Bot, and the decision helpers DM the
    // member through it rather than through the context. Left alone it would dial
    // api.telegram.org with a placeholder token and fail every send, so "blocked"
    // and "delivered" would be indistinguishable and the assertions meaningless.
    (bot.api as unknown as { sendMessage: unknown }).sendMessage = api.sendMessage;
    const { db } = await import("../src/core/db.js");
    const schema = await import("../src/db/schema.js");
    await db.delete(schema.accessRequests).where(eq(schema.accessRequests.telegramId, TARGET));
    await db.delete(schema.users).where(eq(schema.users.telegramId, TARGET));
    await db.delete(schema.admins).where(eq(schema.admins.telegramId, TARGET));
    await store.loadAccess();
  });

  it("does not tell the admin their approval was delivered when it was not", async () => {
    await run(textUpdate(`/allow ${TARGET}`));

    assert.match(allText(), /could not deliver/i, "the failure has to be visible");
    assert.doesNotMatch(allText(), /have been told/i, "and the false confirmation must be gone");
    assert.equal(store.isAllowed(TARGET), true, "the decision itself still stands");
  });

  it("does the same for a rejection", async () => {
    const { requestAccess } = await import("../src/modules/admin/requests.js");
    await requestAccess({ telegramId: TARGET });

    sent = [];
    await run(textUpdate(`/reject ${TARGET}`));

    assert.match(allText(), /could not deliver/i);
    assert.doesNotMatch(allText(), /have been told/i);
    assert.equal(store.isAllowed(TARGET), false, "they are still turned away");
  });

  it("does the same for a delete", async () => {
    const { db } = await import("../src/core/db.js");
    const schema = await import("../src/db/schema.js");
    await db.insert(schema.users).values({ telegramId: TARGET, firstName: "Target" });

    sent = [];
    await run(textUpdate(`/deleteuser ${TARGET}`));

    assert.match(allText(), /could not deliver/i);
    assert.doesNotMatch(allText(), /have been told/i);
    const left = await db.select().from(schema.users).where(eq(schema.users.telegramId, TARGET));
    assert.equal(left.length, 0, "the delete still happened");
  });

  it("still reports a delivery that worked as a delivery", async () => {
    blocked = new Set();
    await run(textUpdate(`/allow ${TARGET}`));

    assert.doesNotMatch(allText(), /could not deliver/i, "no false alarm on a good send");
    assert.match(allText(), /have been told/i);
  });
});

/**
 * The last composer that could swallow a command.
 *
 * The two testimony composers had this bug and so did the auth composer: it sits
 * above memberGate, so anybody can be in a registration flow, and it claimed
 * message:text with no command guard. A member who typed /start at the email
 * prompt had it lowercased and email-validated, and one who typed it at the
 * confirm step was told their two passwords did not match.
 */
describe("commands survive a registration flow", () => {
  const member = { id: 424243, first_name: "Registrar" };

  beforeEach(async () => {
    sent = [];
    blocked = new Set();
    const { db } = await import("../src/core/db.js");
    const schema = await import("../src/db/schema.js");
    await db.delete(schema.users).where(eq(schema.users.telegramId, String(member.id)));
  });

  it("does not email-validate a command at the email prompt", async () => {
    await run(callbackUpdate("plans:register", member));
    assert.match(allText(), /email/i, "precondition: they are at the email prompt");

    sent = [];
    await run(textUpdate("/start", member));
    assert.doesNotMatch(allText(), /valid email/i, "/start was validated as an email address");
    assert.doesNotMatch(allText(), /enter a password/i, "and did not advance the flow");
  });

  it("does not lose a command at the password prompt", async () => {
    await run(callbackUpdate("plans:register", member));
    await run(textUpdate("newcomer@example.test", member));
    assert.match(allText(), /password/i, "precondition: they are at the password prompt");

    sent = [];
    await run(textUpdate("/menu", member));
    assert.doesNotMatch(allText(), /at least \d+ characters/i, "/menu was taken as the password");
  });

  it("does not tell a member their passwords differ because they typed a command", async () => {
    await run(callbackUpdate("plans:register", member));
    await run(textUpdate("newcomer@example.test", member));
    await run(textUpdate("correcthorsebattery", member));
    assert.match(allText(), /confirm/i, "precondition: they are at the confirm prompt");

    sent = [];
    await run(textUpdate("/logout", member));
    assert.doesNotMatch(allText(), /do not match/i, "/logout was taken as a password attempt");
  });

  it("still accepts a real email and a real password afterwards", async () => {
    await run(callbackUpdate("plans:register", member));
    await run(textUpdate("/start", member));
    sent = [];
    await run(textUpdate("newcomer@example.test", member));
    assert.match(allText(), /password/i, "the flow is unharmed by the command going through");
  });
});

// Importing the composers pulls in the module chain that opens the postgres
// pool. Without closing it the test process keeps a live handle and never exits,
// which looks like a hung suite rather than a leaked pool.
after(async () => {
  await store.disallowUser(TARGET);
  await store.demoteAdmin(TARGET);
  await closeDb();
});
