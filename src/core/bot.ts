import { Bot, webhookCallback } from "grammy";
import { createServer, type Server } from "node:http";
import { env, isProd } from "./config.js";
import { logger } from "./logger.js";

export type AppContext = import("grammy").Context;

export const bot = new Bot<AppContext>(env.BOT_TOKEN);

bot.catch((err) => {
  logger.error({ error: err.error, ctx: err.ctx }, "bot error");
});

const UPDATE_TYPES: ReadonlyArray<"message" | "callback_query"> = ["message", "callback_query"];

export async function startBot(): Promise<Server | undefined> {
  if (env.BOT_MODE === "webhook" && env.BOT_WEBHOOK_URL) {
    const secretToken = `whsec_${env.BOT_TOKEN.split(":")[0]}`;
    const webhookUrl = env.BOT_WEBHOOK_URL + env.BOT_WEBHOOK_PATH;

    try {
      const info = await bot.api.getWebhookInfo();
      if (info.url !== webhookUrl) {
        await bot.api.setWebhook(webhookUrl, {
          allowed_updates: UPDATE_TYPES,
          secret_token: secretToken,
        });
      }
    } catch (err) {
      logger.error({ err }, "failed to configure webhook; serving updates anyway");
    }

    const handler = webhookCallback(bot, "http", { secretToken, timeoutMilliseconds: 10_000 });
    const server = createServer((req, res) => void handler(req, res));

    const port = Number(process.env.PORT ?? env.BOT_WEBHOOK_PORT);
    await new Promise<void>((resolve) => server.listen(port, resolve));
    logger.info({ website: env.BOT_WEBHOOK_URL, port }, "bot receiving webhooks");

    return server;
  }

  await bot.start({ allowed_updates: UPDATE_TYPES, drop_pending_updates: isProd ? false : true });
  logger.info("bot running on long polling");
  return undefined;
}