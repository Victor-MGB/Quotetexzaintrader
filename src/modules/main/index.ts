import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { bot } from "../../core/bot.js";
import { adminIds } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { escapeHtml } from "../../shared/html.js";
import { requireSession } from "../../shared/requireSession.js";
import {
  MIN_WITHDRAWAL,
  PROMOS,
  REPORT_CATEGORIES,
  WALLETS,
  promoByKey,
  reportCategoryByKey,
  walletByKey,
} from "./content.js";
import { backRow, editScreen, promoBlock, promoTerms, showDepositAddress } from "./screen.js";
import { referralScreen } from "../referrals/screen.js";
import { findUserByTelegramId } from "../auth/users.js";
import { createTransaction } from "../transactions/store.js";
import { notifyAdminsTransaction } from "../transactions/admin.js";

const main = new Composer<AppContext>();

type Compose =
  | { kind: "deposit"; method: string }
  | { kind: "withdraw"; step: "address" | "amount"; address?: string }
  | { kind: "promo"; promo: string }
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
    .text("⭐ Testimony", "main:testimony")
    .row()
    .text("🎁 Promo Plan", "main:promo")
    .text("📞 Contact Admin", "main:contact")
    .row()
    .text("🚩 Report", "main:report")
    .text("👤 Profile", "main:profile");
}

export function mainMenuButton(): InlineKeyboard {
  return new InlineKeyboard().text("🏠 Main Menu", "main:menu");
}

const cancelKeyboard = () =>
  new InlineKeyboard().text("✖ Cancel", "main:cancel").text("🏠 Main Menu", "main:menu");

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
  await editScreen(ctx, "Cancelled.", mainMenuButton());
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

  await ctx.answerCallbackQuery();
  await showDepositAddress(ctx, wallet, "main:deposit");
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
    new InlineKeyboard()
      .text("📝 Submit Withdrawal Request", "main:withdraw_start")
      .row()
      .text("🏠 Main Menu", "main:menu"),
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

main.callbackQuery("main:promo", async (ctx) => {
  await ctx.answerCallbackQuery();

  const entries = PROMOS.map(promoBlock).join("\n\n");

  const kb = new InlineKeyboard();
  for (const p of PROMOS) {
    kb.text(`${p.icon} ${p.title}`, `main:promo_${p.key}`).row();
  }

  await editScreen(
    ctx,
    `💎 <b>INVESTMENT PROMO — OPEN</b>

An open invitation to join our investor programme. Deposit from $500 and
receive twice your deposit back, credited within 12 hours of the deposit
being confirmed. The more you invest, the higher the return.

${entries}

Tap an offer to claim it — an admin confirms and applies it to your account.`,
    backRow(kb, "main:menu"),
  );
});

main.callbackQuery(/^main:promo_([\w-]+)$/, async (ctx) => {
  const promo = promoByKey(ctx.match[1] ?? "");
  if (!promo) {
    await ctx.answerCallbackQuery("Bonus not found");
    return;
  }

  // The referral reward is driven by the tracked deep link, so it shows a shareable
  // link instead of the manual "type anything to claim" confirmation flow.
  if (promo.key === "referral") {
    await ctx.answerCallbackQuery();
    await referralScreen(ctx);
    return;
  }

  const id = String(ctx.from?.id ?? 0);
  composing.set(id, { kind: "promo", promo: promo.key });

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `💎 <b>CLAIMING ${escapeHtml(promo.title.toUpperCase())}</b>

${promoTerms(promo)}

Type anything to confirm your claim, or add the plan/deposit you want it applied to.`,
    { reply_markup: cancelKeyboard() },
  );
});

main.callbackQuery("main:referral", async (ctx) => {
  await ctx.answerCallbackQuery();
  await referralScreen(ctx);
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

    // A convenience check so the member learns straight away rather than after an
    // admin reviews it. settle() re-checks under a row lock at approval time,
    // because the balance can move between this message and that tap.
    const available = (await findUserByTelegramId(id))?.balance ?? 0;
    if (amount > available) {
      await ctx.reply(
        `You can withdraw at most $${available.toLocaleString("en-US")}, which is your current balance.\n\n` +
          `Send $${available.toLocaleString("en-US")} or less, or tap Cancel to stop.`,
        { reply_markup: cancelKeyboard() },
      );
      return;
    }

    composing.delete(id);
    const sender = senderName(ctx);
    const record = await createTransaction({
      telegramId: sender.id,
      type: "withdrawal",
      amount,
      address: state.address,
    });
    await notifyAdminsTransaction(
      record,
      `🏦 <b>Withdrawal request</b>`,
      `👤 ${escapeHtml(sender.name)}
🏷 Payout wallet: <code>${escapeHtml(state.address ?? "")}</code>`,
    );
    await ctx.reply(
      `✅ Withdrawal request received for $${amount}.

An admin will confirm and pay it to <code>${escapeHtml(state.address ?? "")}</code> within 24 hours.`,
      { reply_markup: mainMenuButton() },
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
    const record = await createTransaction({
      telegramId: sender.id,
      type: "deposit",
      method: state.method,
      reference: text,
    });
    await notifyAdminsTransaction(
      record,
      "💳 <b>Deposit submitted</b>",
      `👤 ${escapeHtml(sender.name)}
🪙 Method: ${wallet ? `${wallet.asset} (${wallet.label})` : "unknown"}`,
    );
    await ctx.reply("✅ Transaction ID received. An admin will verify it and credit your balance.", {
      reply_markup: mainMenuButton(),
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
      reply_markup: mainMenuButton(),
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
    reply_markup: mainMenuButton(),
  });
});

export { main };
