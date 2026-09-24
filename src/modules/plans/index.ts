import { Composer, InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { loginKeyboard, registerKeyboard } from "../auth/index.js";
import { isLoggedIn, touch } from "../auth/session.js";
import { findUserByTelegramId } from "../auth/users.js";
import { PLANS, planByKey } from "./plans.js";

const plans = new Composer<AppContext>();

async function requireSession(ctx: AppContext): Promise<boolean> {
  const id = String(ctx.from?.id ?? 0);
  if (isLoggedIn(id)) {
    touch(id);
    return true;
  }
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery("Session expired").catch(() => undefined);
  }
  await ctx.reply(
    `⏰ Your session is inactive or expired.

For your security, please login again before performing any task.`,
    { reply_markup: loginKeyboard },
  );
  return false;
}

plans.command("plans", async (ctx) => {
  if (!(await requireSession(ctx))) return;
  await ctx.reply(`💰 <b>INVESTMENT PLANS</b>

Choose a plan to see full details.`, {
    reply_markup: planListKeyboard(),
    parse_mode: "HTML",
  });
});

export function planListKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of PLANS) {
    const label = `${p.name}  ·  ${p.percent}%  ·  $${p.min}+`;
    kb.text(label, `plans:detail_${p.key}`).row();
  }
  return kb;
}

plans.callbackQuery("plans:list", async (ctx) => {
  if (!(await requireSession(ctx))) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `💰 <b>INVESTMENT PLANS</b>

Choose a plan to see full details.`,
    { reply_markup: planListKeyboard(), parse_mode: "HTML" },
  );
});

plans.callbackQuery("plans:view", async (ctx) => {
  const from = ctx.from;
  if (!from) return;

  const id = String(from.id);

  if (!isLoggedIn(id)) {
    const user = await findUserByTelegramId(id);
    await ctx.answerCallbackQuery();
    if (!user) {
      await ctx.editMessageText(
        `You need an account to view investment plans.

Register to unlock access to available packages.`,
        { reply_markup: registerKeyboard },
      );
    } else {
      await ctx.editMessageText(
        `Welcome back${from.username ? `, @${from.username}` : ""}.

Login to continue.`,
        { reply_markup: loginKeyboard },
      );
    }
    return;
  }

  touch(id);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `💰 <b>INVESTMENT PLANS</b>

Choose a plan to see full details.`,
    { reply_markup: planListKeyboard(), parse_mode: "HTML" },
  );
});

plans.callbackQuery(/^plans:detail_(.+)$/, async (ctx) => {
  if (!(await requireSession(ctx))) return;
  const key = ctx.match[1];
  const plan = key ? planByKey(key) : undefined;
  if (!plan) {
    await ctx.answerCallbackQuery("Plan not found");
    return;
  }

  const maxText = plan.max === null ? "Unlimited" : `$${plan.max}`;
  const kb = new InlineKeyboard().text("💳 Deposit", `plans:deposit_${plan.key}`).row().text("⬅ Back", "plans:list");

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `━━━ ✦ ${plan.name} ✦ ━━━

📈 <b>Return:</b>   ${plan.percent}%
⏱ <b>Duration:</b>  after ${plan.duration}
💵 <b>Min:</b>      $${plan.min}
💵 <b>Max:</b>      ${maxText}

💬 <b>What you invest in:</b>
${plan.message}

<i>Start your journey to financial freedom today.</i>`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
});

const mainMenuKeyboard = () =>
  new InlineKeyboard().text("🌐 Chat Support", "support:start").row().text("💼 View Plans", "plans:list");

function walletKeyboard(planKey: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("₿ Bitcoin", `plans:wallet_${planKey}_btc`)
    .row()
    .text("💵 USDT (TRC20)", `plans:wallet_${planKey}_trc20`)
    .row()
    .text("🪙 Tron (TRX)", `plans:wallet_${planKey}_trx`)
    .row()
    .text("◆ Ethereum (ETH)", `plans:wallet_${planKey}_eth`)
    .row()
    .text("⬅ Back", "plans:list")
    .text("🏠 Main Menu", "plans:main");
}

plans.callbackQuery(/^plans:deposit_(.+)$/, async (ctx) => {
  if (!(await requireSession(ctx))) return;
  const key = ctx.match[1];
  const plan = key ? planByKey(key) : undefined;
  if (!plan) {
    await ctx.answerCallbackQuery("Plan not found");
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `💳 <b>Fund your ${plan.name} investment</b>

Send your deposit to any of the wallets below and your balance will be credited.

<i>Choose your payment method:</i>`,
    { reply_markup: walletKeyboard(plan.key), parse_mode: "HTML" },
  );
});

plans.callbackQuery(/^plans:wallet_(.+)_(btc|trc20|trx|eth)$/, async (ctx) => {
  if (!(await requireSession(ctx))) return;
  await ctx.answerCallbackQuery("Addresses coming next");
});

plans.callbackQuery("plans:main", async (ctx) => {
  if (!(await requireSession(ctx))) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`🏠 <b>Main Menu</b>

What would you like to do?`, {
    reply_markup: mainMenuKeyboard(),
    parse_mode: "HTML",
  });
});

export { plans };