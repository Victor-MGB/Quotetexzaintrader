import type { BotName, BotDescription, BotShortDescription } from "@grammyjs/types/settings.js";
import { bot } from "./bot.js";
import { logger } from "./logger.js";

const NAME = "QuotexZainTrader";

const DESCRIPTION = `
QuotexZainTrader is a NEW YORK investment Bot that creates opportunities for investors to maximise their profits within few hours of making deposits.

INVESTMENT PLANS:
STARTER - 10% after 6 Hours ($50-$150)
CLASSIC - 12% after 10 Hours ($200-$350)
GOLD - 20% after 24 hours ($400-$550)
AWARD - 25% after 4 days ($1000-Unlimited)

Start your journey to financial freedom with QuotexZainTrader today.
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