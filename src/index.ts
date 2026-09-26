import type { Server } from "node:http";
import { bot } from "./core/bot.js";
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
import { loadAccess } from "./modules/admin/store.js";

bot.use(rateLimit);
bot.use(adminGate);
bot.use(start);
bot.use(plans);
bot.use(auth);
bot.use(profile);
bot.use(admin);
bot.use(mainMenu);
bot.use(support);

bot.catch((err) => {
  logger.error({ err }, "handler error (non-fatal)");
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