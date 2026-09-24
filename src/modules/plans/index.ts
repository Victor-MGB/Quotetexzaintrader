import { Composer } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { loginKeyboard, registerKeyboard } from "../auth/index.js";
import { findUserByTelegramId } from "../auth/users.js";

const plans = new Composer<AppContext>();

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

export { plans };