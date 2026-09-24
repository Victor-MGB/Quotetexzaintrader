import { Composer, InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { loginKeyboard, registerKeyboard } from "../auth/index.js";
import { findUserByTelegramId } from "../auth/users.js";
import { PLANS, planByKey } from "./plans.js";

const plans = new Composer<AppContext>();

export function planListKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of PLANS) {
    const label = `${p.name}  ·  ${p.percent}%  ·  $${p.min}+`;
    kb.text(label, `plans:detail_${p.key}`).row();
  }
  return kb;
}

plans.callbackQuery("plans:list", async (ctx) => {
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

  const user = await findUserByTelegramId(String(from.id));

  if (!user) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `You need an account to view investment plans.

Register to unlock access to available packages.`,
      { reply_markup: registerKeyboard },
    );
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `Welcome back${from.username ? `, @${from.username}` : ""}.

Plans are ready. Login to continue.`,
    { reply_markup: loginKeyboard },
  );
});

plans.callbackQuery(/^plans:detail_(.+)$/, async (ctx) => {
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

<i>Start your journey to financial freedom today.</i>`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
});

plans.callbackQuery(/^plans:deposit_(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  const plan = key ? planByKey(key) : undefined;
  if (!plan) {
    await ctx.answerCallbackQuery("Plan not found");
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(`💳 Deposits for the ${plan.name} plan are being enabled next (Paystack).`, {
    parse_mode: "HTML",
  });
});

export { plans };