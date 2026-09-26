import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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

export const REFERRAL_STATUSES = ["joined", "registered", "qualified"] as const;

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

// Kept separate from `users` because that table requires a unique email, so an
// invitee who has not registered yet has nowhere to be recorded. inviteeId is
// unique so attribution is first-touch only, even under concurrent /start calls.
export const referrals = pgTable(
  "referrals",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    referrerId: text("referrer_id").notNull(),
    inviteeId: text("invitee_id").notNull(),
    status: text("status").$type<ReferralStatus>().notNull().default("joined"),
    rewardPaid: boolean("reward_paid").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("referrals_invitee_id_idx").on(t.inviteeId),
    index("referrals_referrer_id_idx").on(t.referrerId),
  ],
);