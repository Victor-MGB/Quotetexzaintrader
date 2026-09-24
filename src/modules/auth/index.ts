import { Composer, InlineKeyboard, type NextFunction } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { hashPassword, verifyPassword } from "./password.js";
import { clearFlow, getFlow, setFlow } from "./state.js";
import { createUser, findUserByEmail, findUserByTelegramId } from "./users.js";

const auth = new Composer<AppContext>();

export const loginKeyboard = new InlineKeyboard().text("Login", "plans:login");
export const registerKeyboard = new InlineKeyboard().text("Register / Create Account", "plans:register");
const bothKeyboard = new InlineKeyboard().text("Register / Create Account", "plans:register").text("Login", "plans:login");
const cancelKeyboard = new InlineKeyboard().text("Cancel", "auth:cancel");

const MIN_PASSWORD_LENGTH = 6;

function extractUser(ctx: AppContext) {
  const from = ctx.from;
  if (!from) return null;
  return {
    telegramId: String(from.id),
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  };
}

auth.callbackQuery("plans:register", async (ctx) => {
  const data = extractUser(ctx);
  if (!data) return;

  const existing = await findUserByTelegramId(data.telegramId);
  if (existing) {
    await ctx.answerCallbackQuery("You already have an account");
    await ctx.editMessageText(`You already have an account. Login instead.`, { reply_markup: loginKeyboard });
    return;
  }

  setFlow(data.telegramId, { flow: "register-email" });
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `Create your account.

Enter your email address.`,
    { reply_markup: cancelKeyboard },
  );
});

auth.callbackQuery("plans:login", async (ctx) => {
  const data = extractUser(ctx);
  if (!data) return;

  const existing = await findUserByTelegramId(data.telegramId);
  if (!existing) {
    await ctx.answerCallbackQuery("No account found");
    await ctx.editMessageText(`No account found. Please register first.`, { reply_markup: registerKeyboard });
    return;
  }

  setFlow(data.telegramId, { flow: "login" });
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `Enter your password to login${data.username ? ` as @${data.username}` : ""}.`,
    { reply_markup: cancelKeyboard },
  );
});

auth.callbackQuery("auth:cancel", async (ctx) => {
  clearFlow(String(ctx.from?.id ?? 0));
  await ctx.answerCallbackQuery("Cancelled");
  await ctx.editMessageText(`Cancelled. Use the menu to continue.`);
});

auth.on("message:text", async (ctx, next: NextFunction) => {
  const data = extractUser(ctx);
  if (!data) return next();

  const entry = getFlow(data.telegramId);
  if (!entry) return next();

  const text = ctx.message.text.trim();

  if (entry.flow === "register-email") {
    const email = text.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await ctx.reply("That doesn't look like a valid email. Try again.");
      return;
    }
    const existingEmail = await findUserByEmail(email);
    if (existingEmail) {
      await ctx.reply("An account with that email already exists. Use Login instead.", {
        reply_markup: loginKeyboard,
      });
      return;
    }
    setFlow(data.telegramId, { flow: "register-password", email });
    await ctx.reply(
      `Email "${email}" noted.

Now enter a password (minimum ${MIN_PASSWORD_LENGTH} characters).`,
      { reply_markup: cancelKeyboard },
    );
    return;
  }

  if (entry.flow === "register-password") {
    if (text.length < MIN_PASSWORD_LENGTH) {
      await ctx.reply(`Password must be at least ${MIN_PASSWORD_LENGTH} characters. Try again.`);
      return;
    }
    setFlow(data.telegramId, { flow: "register-confirm", email: entry.email, password: text });
    await ctx.reply("Confirm your password by entering it again.", { reply_markup: cancelKeyboard });
    return;
  }

  if (entry.flow === "register-confirm") {
    if (text !== entry.password) {
      setFlow(data.telegramId, { flow: "register-password", email: entry.email });
      await ctx.reply(`Passwords do not match. Enter a new password (minimum ${MIN_PASSWORD_LENGTH} characters).`);
      return;
    }

    const passwordHash = await hashPassword(text);
    const user = await createUser({ ...data, email: entry.email ?? "", passwordHash });
    clearFlow(data.telegramId);

    if (!user) {
      await ctx.reply("An account for this Telegram user already exists. Login instead.", {
        reply_markup: loginKeyboard,
      });
      return;
    }

    await ctx.reply(
      `Account created${data.username ? ` for @${data.username}` : ""}. 🎉

Login to view investment plans.`,
      { reply_markup: loginKeyboard },
    );
    return;
  }

  if (entry.flow === "login") {
    const user = await findUserByTelegramId(data.telegramId);
    if (!user?.passwordHash) {
      clearFlow(data.telegramId);
      await ctx.reply("This account has no password set. Register a new account.", {
        reply_markup: bothKeyboard,
      });
      return;
    }
    const ok = await verifyPassword(text, user.passwordHash);
    if (!ok) {
      await ctx.reply("Wrong password. Try again, or tap Cancel to stop.");
      return;
    }
    clearFlow(data.telegramId);
    await ctx.reply(
      `Logged in as ${data.username ? `@${data.username}` : user.firstName ?? "member"}. ✅

Investment plans are coming in the next step.`,
    );
  }
});

export { auth };