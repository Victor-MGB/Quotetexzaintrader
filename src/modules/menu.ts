import type { BotCommand } from "@grammyjs/types";
import type { User } from "@grammyjs/types";
import { bot } from "../core/bot.js";
import { adminIds } from "../core/config.js";
import { logger } from "../core/logger.js";
import { isAllowed } from "./admin/store.js";

const cache = new Map<number, string>();

interface MenuRole {
  commands: BotCommand[];
  menu: { type: "commands" };
}

const MENUS: Record<"admin" | "user" | "restricted", MenuRole> = {
  admin: {
    commands: [
      { command: "start", description: "Start" },
      { command: "menu", description: "Main menu" },
      { command: "plans", description: "View investment plans" },
      { command: "profile", description: "Your balance and account" },
      { command: "logout", description: "Log out (secure)" },
      { command: "allow", description: "Approve a user (id)" },
      { command: "disallow", description: "Remove access (id)" },
      { command: "list", description: "List allowed users" },
      { command: "users", description: "List all registered users" },
      { command: "deleteuser", description: "Delete a user (id)" },
      { command: "lock", description: "Lock the bot" },
      { command: "unlock", description: "Unlock the bot" },
      { command: "status", description: "Bot status" },
      { command: "setaddress", description: "Set a deposit address" },
      { command: "addresses", description: "Show deposit addresses" },
    ],
    menu: { type: "commands" },
  },
  user: {
    commands: [
      { command: "start", description: "Start" },
      { command: "menu", description: "Main menu" },
      { command: "plans", description: "View investment plans" },
      { command: "profile", description: "Your balance and account" },
      { command: "logout", description: "Log out (secure)" },
    ],
    menu: { type: "commands" },
  },
  restricted: {
    commands: [{ command: "start", description: "Start" }],
    menu: { type: "commands" },
  },
};

export function roleFor(id: string | number): "admin" | "user" | "restricted" {
  const sid = String(id);
  if (adminIds.includes(sid)) return "admin";
  if (isAllowed(sid)) return "user";
  return "restricted";
}

export async function refreshMenu(from: User): Promise<void> {
  const role = roleFor(from.id);
  if (cache.get(from.id) === role) return;
  cache.set(from.id, role);

  const preset = MENUS[role];
  await Promise.allSettled([
    bot.api.setMyCommands(preset.commands, { scope: { type: "chat", chat_id: from.id } }),
    bot.api.setChatMenuButton({ chat_id: from.id, menu_button: preset.menu }),
  ]);
  logger.debug({ userId: from.id, role }, "menu refreshed");
}

export function invalidateMenu(id: number): void {
  cache.delete(id);
}