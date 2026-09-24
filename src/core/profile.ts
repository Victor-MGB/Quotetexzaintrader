import type { BotName, BotDescription, BotShortDescription } from "@grammyjs/types/settings.js";
import { bot } from "./bot.js";
import { logger } from "./logger.js";

const NAME = "QuotexZainTrader";

const DESCRIPTION = `
Invest and grow your funds with QuotexZainTrader.

High-yield investment plans, instant withdrawals, secure wallet and 24/7 referral bonuses.

Press Start to create your account and see available plans.
`.trim();

const SHORT_DESCRIPTION = "High-yield investment plans. Start your account and grow your balance.";

async function apply(action: () => Promise<unknown>, method: string): Promise<void> {
  try {
    await action();
    logger.info({ method }, "bot profile updated");
  } catch (err) {
    logger.warn({ err, method }, "failed to update bot profile (non-fatal)");
  }
}

async function current(fn: () => Promise<object>): Promise<string | undefined> {
  try {
    return Object.values(await fn())[0] as string | undefined;
  } catch {
    return undefined;
  }
}

export async function applyBotProfile(): Promise<void> {
  const [currentName, currentDesc, currentShort] = await Promise.all([
    current(() => bot.api.getMyName() as Promise<BotName>),
    current(() => bot.api.getMyDescription() as Promise<BotDescription>),
    current(() => bot.api.getMyShortDescription() as Promise<BotShortDescription>),
  ]);

  if (currentName !== NAME) await apply(() => bot.api.setMyName(NAME), "setMyName");
  if (currentDesc !== DESCRIPTION) await apply(() => bot.api.setMyDescription(DESCRIPTION), "setMyDescription");
  if (currentShort !== SHORT_DESCRIPTION)
    await apply(() => bot.api.setMyShortDescription(SHORT_DESCRIPTION), "setMyShortDescription");
}