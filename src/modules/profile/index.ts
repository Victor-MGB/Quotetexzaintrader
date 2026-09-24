import { Composer } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { findUserByTelegramId } from "../auth/users.js";

const profile = new Composer<AppContext>();

profile.command("profile", async (ctx) => {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(String(from.id));
  if (!user) {
    await ctx.reply("No account yet. Use the menu to create one.");
    return;
  }

  const balance = Number(user.balance ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  await ctx.reply(
    `👤 <b>Your Profile</b>\n\n` +
      `🆔 ID: <code>${from.id}</code>\n` +
      `${user.email ? `📧 Email: <code>${user.email}</code>\n` : ""}` +
      `👤 Username: ${from.username ? `@${from.username}` : "—"}\n` +
      `💵 Balance: <b>${balance}</b>`,
    { parse_mode: "HTML" },
  );
});

export { profile };