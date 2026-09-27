import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Update } from "grammy/types";

/**
 * Drives the real grammy composer with a stubbed API.
 *
 * This exists because of a bug that 99 other tests could not see: after media
 * was chosen the draft stayed on step "media", so the step 4 text fell through
 * to next() and was swallowed with no reply, draft.message could never be set,
 * and the composer could never reach publish. Nothing asserted on the sequence
 * of replies, so the whole flow was untested.
 *
 * The stub records what the bot tried to say, which is the only place the
 * failure was visible: the admin saw nothing come back.
 */

const { ensureTestEnv } = await import("./helpers/env.js");
ensureTestEnv();

const { closeDb } = await import("./helpers/db.js");
const { Context } = await import("grammy");
const { testimonyAdmin } = await import("../src/modules/admin/testimony.js");
const { adminIds } = await import("../src/core/config.js");

// ensureTestEnv sets ADMIN_IDS to a synthetic id, so the real one would fail
// the guard and every reply would silently be "Admins only".
const ADMIN_ID = Number(adminIds[0]);
const CHAT_ID = 4242;

interface Sent {
  text: string;
  keyboard?: unknown;
}

let sent: Sent[] = [];

/** The slice of grammy Api the composer actually touches. */
const api = {
  sendMessage(chatId: number, text: string, other?: { reply_markup?: unknown }) {
    sent.push({ text, keyboard: other?.reply_markup });
    return Promise.resolve({ message_id: sent.length, chat: { id: chatId, type: "private", first_name: "Patrick" }, date: 0 });
  },
  answerCallbackQuery() {
    return Promise.resolve(true);
  },
  editMessageText(_id: unknown, _chat: unknown, text: string) {
    sent.push({ text });
    return Promise.resolve(true);
  },
  editMessageCaption() {
    return Promise.resolve(true);
  },
  editMessageReplyMarkup() {
    return Promise.resolve(true);
  },
  deleteMessage() {
    return Promise.resolve(true);
  },
  getFile() {
    return Promise.resolve({ file_id: "x", file_unique_id: "x", file_path: "photos/x.jpg" });
  },
};

const me = { id: 1, is_bot: true, first_name: "bot", username: "bot" };

async function run(update: Update): Promise<void> {
  const ctx = new Context(update as never, api as never, me as never);
  await (testimonyAdmin.middleware() as never as (c: unknown, n: () => Promise<void>) => Promise<void>)(
    ctx,
    async () => undefined,
  );
}

function textUpdate(text: string): Update {
  return {
    update_id: sent.length + 1,
    message: {
      message_id: sent.length + 1,
      date: 0,
      chat: { id: CHAT_ID, type: "private", first_name: "Patrick" },
      from: { id: ADMIN_ID, is_bot: false, first_name: "Patrick", username: "Hhytko" },
      text,
    },
  };
}

function callbackUpdate(data: string): Update {
  return {
    update_id: sent.length + 1,
    callback_query: {
      id: String(sent.length + 1),
      from: { id: ADMIN_ID, is_bot: false, first_name: "Patrick", username: "Hhytko" },
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

describe("the admin testimony composer, end to end", () => {
  it("walks name, plan, media, message, preview and can publish", async () => {
    sent = [];

    // Step 1: the name.
    await run(callbackUpdate("tstadmin:new"));
    assert.match(lastText(), /step 1 of 4/i);
    await run(callbackUpdate("tstadmin:name_custom"));
    await run(textUpdate("Sarah Okonkwo"));
    assert.match(lastText(), /step 2 of 4/i);

    // Step 2: the plan.
    await run(callbackUpdate("tstadmin:p_STARTER"));
    assert.match(lastText(), /step 3 of 4/i);

    // Step 3: media from the library.
    await run(callbackUpdate("tstadmin:m_0"));
    assert.match(lastText(), /step 4 of 4/i);

    // Step 4: the message. This is the step that used to vanish.
    await run(textUpdate("My first payout landed in under two days."));
    assert.match(lastText(), /Preview/i, "step 4 should reach the preview");

    // And publish.
    await run(callbackUpdate("tstadmin:publish"));
    assert.match(lastText(), /published|done|live/i);
  });

  it("rejects a too-short step 4 message instead of swallowing it", async () => {
    sent = [];
    await run(callbackUpdate("tstadmin:new"));
    await run(callbackUpdate("tstadmin:name_custom"));
    await run(textUpdate("Sarah Okonkwo"));
    await run(callbackUpdate("tstadmin:p_STARTER"));
    await run(callbackUpdate("tstadmin:m_0"));

    // "Google" is what was typed in the real session. It must get a reply.
    await run(textUpdate("Google"));

    assert.notEqual(lastText(), "", "a short message must still be answered");
    assert.match(lastText(), /too short/i);
    assert.doesNotMatch(lastText(), /step 4 of 4/i, "it must not claim to be waiting again");
  });

  it("accepts the message once it is long enough", async () => {
    sent = [];
    await run(callbackUpdate("tstadmin:new"));
    await run(callbackUpdate("tstadmin:name_custom"));
    await run(textUpdate("Sarah Okonkwo"));
    await run(callbackUpdate("tstadmin:p_STARTER"));
    await run(callbackUpdate("tstadmin:m_0"));
    await run(textUpdate("Payout arrived in about an hour and the support replies fast."));

    assert.match(lastText(), /Preview/i);
  });
});

// Importing the composer pulls in the module chain that opens the postgres
// pool, and nothing here talks to the database. Without closing it the test
// process has a live handle and never exits, which looks like a hung suite
// rather than a leaked pool.
after(async () => {
  await closeDb();
});
