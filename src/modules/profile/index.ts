import { Composer, InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { escapeHtml } from "../../shared/html.js";
import { isLoggedIn } from "../auth/session.js";
import { findUserByTelegramId } from "../auth/users.js";

const profile = new Composer<AppContext>();

function money(value: number): string {
  return `$${Number(value).toLocaleString("en-US")}`;
}

/**
 * The account screen. Transaction totals and referral stats stay on the
 * dashboard so the two screens answer different questions, and the dashboard
 * stays off the main menu so a first-time member is not greeted by an empty
 * summary.
 */
async function renderProfile(ctx: AppContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const id = String(from.id);
  const user = await findUserByTelegramId(id);
  const username = from.username ? `@${escapeHtml(from.username)}` : "—";

  if (!user) {
    await ctx.reply(
      `👤 <b>Your profile</b>\n\n` +
        `🆔 <code>${id}</code>\n` +
        `👤 Username: ${username}\n\n` +
        `You do not have an account yet. Register to get started, or log back in.`,
      {
        reply_markup: new InlineKeyboard()
          .text("📝 Register", "plans:register")
          .text("🔑 Login", "plans:login")
          .row()
          .text("🏠 Main Menu", "main:menu"),
        parse_mode: "HTML",
      },
    );
    return;
  }

  const lines = [
    `👤 <b>Your profile</b>`,
    "",
    `🆔 <code>${id}</code>`,
    `👤 Username: ${username}`,
    ...(user.email ? [`📧 Email: <code>${escapeHtml(user.email)}</code>`] : []),
    `💰 Balance: <b>${money(user.balance ?? 0)}</b>`,
    `📅 Member since ${user.createdAt.toISOString().slice(0, 10)}`,
  ];

  const kb = new InlineKeyboard();
  // Dashboard and history are session gated, so offer login first when the
  // member still has to authenticate.
  if (isLoggedIn(id)) {
    kb.text("📊 Dashboard", "main:dashboard").text("🧾 History", "main:history");
  } else {
    kb.text("🔑 Log in", "plans:login");
  }
  kb.row().text("🏠 Main Menu", "main:menu");

  await ctx.reply(lines.join("\n"), { reply_markup: kb, parse_mode: "HTML" });
}

profile.command("profile", async (ctx) => {
  await renderProfile(ctx);
});

profile.callbackQuery("main:profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderProfile(ctx);
});

export { profile };
