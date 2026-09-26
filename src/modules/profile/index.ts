import { Composer, InlineKeyboard } from "grammy";
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

  // The dashboard is reachable from here rather than the main menu, so a member
  // who has just arrived is not greeted by an empty summary.
  const kb = new InlineKeyboard()
    .text("📊 Dashboard", "main:dashboard")
    .text("🧾 History", "main:history")
    .row()
    .text("🏠 Main Menu", "main:menu");

  await ctx.reply(
    `👤 <b>Your Profile</b>\n\n` +
      `🆔 ID: <code>${from.id}</code>\n` +
      `${user.email ? `📧 Email: <code>${user.email}</code>\n` : ""}` +
      `👤 Username: ${from.username ? `@${from.username}` : "—"}\n` +
      `💵 Balance: <b>${balance}</b>`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
});

export { profile };