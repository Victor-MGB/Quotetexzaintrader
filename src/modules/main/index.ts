import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { bot } from "../../core/bot.js";
import { adminIds } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { getSetting } from "../../core/settings.js";
import { escapeHtml } from "../../shared/html.js";
import { requireSession } from "../../shared/requireSession.js";
import {
  MIN_WITHDRAWAL,
  PROMOS,
  REPORT_CATEGORIES,
  TESTIMONIES,
  WALLETS,
  promoByKey,
  reportCategoryByKey,
  walletByKey,
} from "./content.js";

const main = new Composer<AppContext>();

type Compose =
  | { kind: "deposit"; method: string }
  | { kind: "withdraw"; step: "address" | "amount"; address?: string }
  | { kind: "promo"; promo: string }
  | { kind: "testimony" }
  | { kind: "report"; category: string };

const composing = new Map<string, Compose>();

const HOME_TEXT = `🏠 <b>MAIN MENU</b>

What would you like to do?`;

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💳 Deposit", "main:deposit")
    .text("🏦 Withdrawal", "main:withdraw")
    .row()
    .text("💼 Investment Plan", "plans:list")
    .row()
    .text("⭐ Testimony", "main:testimony")
    .text("🎁 Promo Plan", "main:promo")
    .row()
    .text("📞 Contact Admin", "main:contact")
    .text("🚩 Report", "main:report");
}

const homeButton = () => new InlineKeyboard().text("🏠 Main Menu", "main:menu");

const backRow = (keyboard: InlineKeyboard, back: string): InlineKeyboard => keyboard.row().text("⬅ Back", back);

const cancelKeyboard = () =>
  new InlineKeyboard().text("✖ Cancel", "main:cancel").text("🏠 Main Menu", "main:menu");

async function editScreen(ctx: AppContext, text: string, keyboard: InlineKeyboard): Promise<void> {
  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "HTML" }).catch((err: unknown) => {
    const description = (err as { description?: string }).description ?? "";
    if (!description.includes("message is not modified")) throw err;
  });
}

async function notifyAdmins(body: string, userId: string): Promise<void> {
  const keyboard = new InlineKeyboard().text("✍️ Reply", `support:reply_${userId}`);
  for (const adminId of adminIds) {
    await bot.api
      .sendMessage(adminId, body, { reply_markup: keyboard, parse_mode: "HTML" })
      .catch((err) => logger.warn({ err, adminId }, "failed to notify admin"));
  }
}

function senderName(ctx: AppContext): { name: string; id: string } {
  const from = ctx.from;
  return {
    id: String(from?.id ?? 0),
    name: from?.username ? `@${from.username}` : from?.first_name ?? "unknown",
  };
}

main.command("menu", async (ctx) => {
  await ctx.reply(HOME_TEXT, {
    reply_markup: mainMenuKeyboard(),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
});

for (const trigger of ["main:menu", "plans:main"]) {
  main.callbackQuery(trigger, async (ctx) => {
    await ctx.answerCallbackQuery();
    await editScreen(ctx, HOME_TEXT, mainMenuKeyboard());
  });
}

main.callbackQuery("main:cancel", async (ctx) => {
  const id = String(ctx.from?.id ?? 0);
  composing.delete(id);
  await ctx.answerCallbackQuery("Cancelled");
  await editScreen(ctx, "Cancelled.", homeButton());
});

main.callbackQuery("main:deposit", async (ctx) => {
  if (!(await requireSession(ctx))) return;

  const kb = new InlineKeyboard();
  for (const w of WALLETS) {
    kb.text(`${w.icon} ${w.label}`, `main:deposit_method_${w.key}`).row();
  }

  await ctx.answerCallbackQuery();
  await editScreen(
    ctx,
    `💳 <b>DEPOSIT</b>

Fund your account, then pick an investment plan. Your balance is credited once the payment is confirmed on the network.

<i>Choose a payment method:</i>`,
    backRow(kb, "main:menu"),
  );
});

main.callbackQuery(/^main:deposit_sent_(\w+)$/, async (ctx) => {
  if (!(await requireSession(ctx))) return;

  const wallet = walletByKey(ctx.match[1] ?? "");
  if (!wallet) {
    await ctx.answerCallbackQuery("Payment method not found");
    return;
  }

  const id = String(ctx.from?.id ?? 0);
  composing.set(id, { kind: "deposit", method: wallet.key });

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `✍️ Deposit sent? Great.

Type the transaction ID (hash) of your ${wallet.asset} payment. An admin will verify it and credit your balance.`,
    { reply_markup: cancelKeyboard() },
  );
});

main.callbackQuery(/^main:deposit_method_(\w+)$/, async (ctx) => {
  if (!(await requireSession(ctx))) return;

  const wallet = walletByKey(ctx.match[1] ?? "");
  if (!wallet) {
    await ctx.answerCallbackQuery("Payment method not found");
    return;
  }

  const address = await getSetting(wallet.settingKey);
  await ctx.answerCallbackQuery();

  if (!address) {
    await editScreen(
      ctx,
      `${wallet.icon} <b>${wallet.label} deposits</b>

⚠️ No ${wallet.asset} address is published yet.

Tap below and an admin will send you the live ${wallet.network} address.`,
      new InlineKeyboard()
        .text("📞 Get Deposit Address", "main:contact")
        .row()
        .text("⬅ Back", "main:deposit")
        .text("🏠 Main Menu", "main:menu"),
    );
    return;
  }

  await editScreen(
    ctx,
    `${wallet.icon} <b>Send ${wallet.asset} — ${wallet.label}</b>

🏷 <b>Address</b>
<code>${escapeHtml(address)}</code>

📡 <b>Network:</b> ${wallet.network}
⏱ <b>Confirmed in:</b> ${wallet.speed}

⚠️ Send <b>only ${wallet.asset}</b> on the <b>${wallet.network}</b> network. Payments sent on any other network cannot be recovered.

Next step: send us the transaction ID so we can credit you faster.`,
    new InlineKeyboard()
      .text("✅ I Have Sent The Payment", `main:deposit_sent_${wallet.key}`)
      .row()
      .text("⬅ Back", "main:deposit")
      .text("🏠 Main Menu", "main:menu"),
  );
});

main.callbackQuery("main:withdraw", async (ctx) => {
  if (!(await requireSession(ctx))) return;

  await ctx.answerCallbackQuery();
  await editScreen(
    ctx,
    `🏦 <b>WITHDRAWAL</b>

Cash out your profits to any wallet you control.

📌 <b>Rules</b>
• Minimum withdrawal: $${MIN_WITHDRAWAL}
• Paid in USDT (TRC20) or TRX
• Processed within 24 hours of approval
• One request per 24 hours
• A session must be closed and cleared before a new request

Tap below to submit a request. You'll be asked for your payout wallet and the amount.`,
    homeButton(),
  );
});

main.callbackQuery("main:withdraw_start", async (ctx) => {
  if (!(await requireSession(ctx))) return;

  const id = String(ctx.from?.id ?? 0);
  composing.set(id, { kind: "withdraw", step: "address" });

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `✍️ <b>Withdrawal request</b>

Step 1 of 2 — send the <b>wallet address</b> you want the funds paid to (USDT TRC20 or TRX).`,
    { reply_markup: cancelKeyboard() },
  );
});

main.callbackQuery("main:testimony", async (ctx) => {
  await ctx.answerCallbackQuery();

  const entries = TESTIMONIES.map(
    (t) => `✦ <b>${escapeHtml(t.member)}</b> · ${t.plan}
${escapeHtml(t.message)}`,
  ).join("\n\n");

  await editScreen(
    ctx,
    `⭐ <b>TESTIMONY</b>

What members say after running a plan with us.

${entries}

💬 Have your own experience to share? Send it to the admin and we may publish it here.`,
    new InlineKeyboard()
      .text("✍️ Share Your Experience", "main:testimony_send")
      .row()
      .text("⬅ Back", "main:menu")
      .text("🏠 Main Menu", "main:menu"),
  );
});

main.callbackQuery("main:testimony_send", async (ctx) => {
  const id = String(ctx.from?.id ?? 0);
  composing.set(id, { kind: "testimony" });

  await ctx.answerCallbackQuery();
  await ctx.reply("✍️ Type your experience in your own words. An admin will review it before it goes live.", {
    reply_markup: cancelKeyboard(),
  });
});

main.callbackQuery("main:promo", async (ctx) => {
  await ctx.answerCallbackQuery();

  const entries = PROMOS.map((p) => `${p.icon} <b>${p.title}</b>\n🎁 ${p.reward}\n📌 ${p.requirement}`).join("\n\n");

  const kb = new InlineKeyboard();
  for (const p of PROMOS) {
    kb.text(`🎁 ${p.title}`, `main:promo_${p.key}`).row();
  }

  await editScreen(
    ctx,
    `🎁 <b>PROMO PLAN</b>

Bonuses you can claim right now.

${entries}

Tap a bonus to claim it — an admin confirms and applies it to your account.`,
    backRow(kb, "main:menu"),
  );
});

main.callbackQuery(/^main:promo_(\w+)$/, async (ctx) => {
  const promo = promoByKey(ctx.match[1] ?? "");
  if (!promo) {
    await ctx.answerCallbackQuery("Bonus not found");
    return;
  }

  const id = String(ctx.from?.id ?? 0);
  composing.set(id, { kind: "promo", promo: promo.key });

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `🎁 Claiming <b>${promo.title}</b>

🎁 ${promo.reward}
📌 ${promo.requirement}

Type anything to confirm your claim, or add the plan/deposit you want it applied to.`,
    { reply_markup: cancelKeyboard() },
  );
});

main.callbackQuery("main:contact", async (ctx) => {
  await ctx.answerCallbackQuery();
  await editScreen(
    ctx,
    `📞 <b>CONTACT ADMIN</b>

An admin is available in this chat — no email, no waiting room.

• Send any question and you get a reply right here
• Deposits, withdrawals and plan questions
• Something wrong? Use Report and it is flagged

For your security, an admin will never ask for your password.`,
    new InlineKeyboard()
      .text("💬 Message Admin", "support:start")
      .row()
      .text("🚩 Report An Issue", "main:report")
      .row()
      .text("⬅ Back", "main:menu")
      .text("🏠 Main Menu", "main:menu"),
  );
});

main.callbackQuery("main:report", async (ctx) => {
  await ctx.answerCallbackQuery();

  const kb = new InlineKeyboard();
  for (const c of REPORT_CATEGORIES) {
    kb.text(`${c.icon} ${c.label}`, `main:report_${c.key}`).row();
  }

  await editScreen(
    ctx,
    `🚩 <b>REPORT</b>

Pick what you want to report. Your report goes straight to the admin with your account details attached.

<i>Choose a category:</i>`,
    backRow(kb, "main:menu"),
  );
});

main.callbackQuery(/^main:report_(\w+)$/, async (ctx) => {
  const category = reportCategoryByKey(ctx.match[1] ?? "");
  if (!category) {
    await ctx.answerCallbackQuery("Category not found");
    return;
  }

  const id = String(ctx.from?.id ?? 0);
  composing.set(id, { kind: "report", category: category.key });

  await ctx.answerCallbackQuery();
  await ctx.reply(`🚩 <b>${category.label}</b>\n\n${category.prompt}`, { reply_markup: cancelKeyboard() });
});

main.on("message:text", async (ctx, next: NextFunction) => {
  const id = String(ctx.from?.id ?? 0);
  const state = composing.get(id);
  if (!state) return next();

  const text = ctx.message.text.trim();

  if (state.kind === "withdraw") {
    if (state.step === "address") {
      if (text.length < 6) {
        await ctx.reply("That address looks too short. Send the full wallet address, or tap Cancel.");
        return;
      }
      composing.set(id, { kind: "withdraw", step: "amount", address: text });
      await ctx.reply(
        `✅ Address noted: <code>${escapeHtml(text)}</code>

Step 2 of 2 — how much do you want to withdraw (minimum $${MIN_WITHDRAWAL})?`,
        { reply_markup: cancelKeyboard() },
      );
      return;
    }

    const amount = Number(text.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL) {
      await ctx.reply(`Enter a valid amount of at least $${MIN_WITHDRAWAL}, for example 250. Tap Cancel to stop.`, {
        reply_markup: cancelKeyboard(),
      });
      return;
    }

    composing.delete(id);
    const sender = senderName(ctx);
    await notifyAdmins(
      `🏦 <b>Withdrawal request</b>

👤 ${escapeHtml(sender.name)}
🆔 <code>${sender.id}</code>
💵 Amount: $${amount}
🏷 Payout wallet: <code>${escapeHtml(state.address ?? "")}</code>`,
      sender.id,
    );
    await ctx.reply(
      `✅ Withdrawal request received for $${amount}.

An admin will confirm and pay it to <code>${escapeHtml(state.address ?? "")}</code> within 24 hours.`,
      { reply_markup: homeButton() },
    );
    return;
  }

  if (!text) {
    await ctx.reply("Send a message with the details, or tap Cancel to stop.");
    return;
  }

  composing.delete(id);
  const sender = senderName(ctx);

  if (state.kind === "deposit") {
    const wallet = walletByKey(state.method);
    await notifyAdmins(
      `💳 <b>Deposit submitted</b>

👤 ${escapeHtml(sender.name)}
🆔 <code>${sender.id}</code>
🪙 Method: ${wallet ? `${wallet.asset} (${wallet.label})` : "unknown"}
🧾 Transaction ID: <code>${escapeHtml(text)}</code>`,
      sender.id,
    );
    await ctx.reply("✅ Transaction ID received. An admin will verify it and credit your balance.", {
      reply_markup: homeButton(),
    });
    return;
  }

  if (state.kind === "promo") {
    const promo = promoByKey(state.promo);
    await notifyAdmins(
      `🎁 <b>Promo claim</b>

👤 ${escapeHtml(sender.name)}
🆔 <code>${sender.id}</code>
🏷 Bonus: ${promo ? escapeHtml(promo.title) : "unknown"}
💬 <b>Member said</b>
${escapeHtml(text)}`,
      sender.id,
    );
    await ctx.reply("🎁 Bonus claim received. An admin will apply it to your account shortly.", {
      reply_markup: homeButton(),
    });
    return;
  }

  if (state.kind === "testimony") {
    await notifyAdmins(
      `⭐ <b>Testimony submitted</b>

👤 ${escapeHtml(sender.name)}
🆔 <code>${sender.id}</code>
💬 <b>Member said</b>
${escapeHtml(text)}`,
      sender.id,
    );
    await ctx.reply("✅ Thank you. An admin will review your message before it is published.", {
      reply_markup: homeButton(),
    });
    return;
  }

  const category = reportCategoryByKey(state.category);
  await notifyAdmins(
    `🚩 <b>Report — ${category ? escapeHtml(category.label) : "Other"}</b>

👤 ${escapeHtml(sender.name)}
🆔 <code>${sender.id}</code>
💬 <b>Report</b>
${escapeHtml(text)}`,
    sender.id,
  );
  await ctx.reply("🚩 Report received. An admin has been notified and will reply here.", {
    reply_markup: homeButton(),
  });
});

export { main };
