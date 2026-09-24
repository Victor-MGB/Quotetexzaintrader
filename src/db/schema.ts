import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    telegramId: text("telegram_id").notNull(),
    username: text(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text(),
    passwordHash: text("password_hash"),
    balance: integer().notNull().default(0),
    referral: text(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    uniqueIndex("users_email_idx").on(t.email),
  ],
);

export const whitelist = pgTable("whitelist", {
  telegramId: text("telegram_id").primaryKey(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});