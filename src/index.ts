import type { Server } from "node:http";
import { bot, reportUpdateError } from "./core/bot.js";
import { checkDb } from "./core/db.js";
import { logger } from "./core/logger.js";
import { logDepositAddresses } from "./core/settings.js";
import { applyBotProfile } from "./core/profile.js";
import { rateLimit } from "./shared/middlewares/rateLimit.js";
import { start } from "./modules/start/index.js";
import { main as mainMenu } from "./modules/main/index.js";
import { plans } from "./modules/plans/index.js";
import { auth } from "./modules/auth/index.js";
import { profile } from "./modules/profile/index.js";
import { admin, adminGate } from "./modules/admin/index.js";
import { support } from "./modules/support/index.js";
import { referralCapture } from "./modules/referrals/index.js";
import { loadAccess } from "./modules/admin/store.js";

// Everything runs inside this boundary so a failing handler is logged instead of
// escaping the middleware chain. grammy only applies bot.catch to long polling, so
// without it a single API error would reject out of the webhook request and kill the process.
const safe = bot.errorBoundary((err) => reportUpdateError(err, "handler error (non-fatal)"));

safe.use(rateLimit);
// Ahead of adminGate on purpose: a referral invitee is not whitelisted yet, so
// attribution has to happen before the gate blocks them.
safe.use(referralCapture);
safe.use(adminGate);
safe.use(start);
safe.use(plans);
safe.use(auth);
safe.use(profile);
safe.use(admin);
safe.use(mainMenu);
safe.use(support);

bot.catch((err) => {
  reportUpdateError(err, "handler error (non-fatal)");
});

async function main(): Promise<void> {
  await checkDb();
  await loadAccess();
  await logDepositAddresses();
  await bot.init();
  logger.info({ username: bot.botInfo.username }, "bot authenticated");
  await applyBotProfile();

  const { startBot } = await import("./core/bot.js");
  const server: Server | undefined = await startBot();

  const shutdown = async () => {
    logger.info("shutting down");
    await bot.stop();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start bot");
  process.exit(1);
});