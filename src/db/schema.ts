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

// Admins promoted at runtime. ADMIN_IDS stays the permanent source, so the bot
// can never be locked out of its own admin tooling.
export const admins = pgTable("admins", {
  telegramId: text("telegram_id").primaryKey(),
  addedBy: text("added_by"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const TRANSACTION_TYPES = ["deposit", "withdrawal"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ["pending", "approved", "rejected"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

// Amount stays null until an admin confirms a deposit: the member only supplies
// the chain hash, and the verified figure comes from the admin who checks it.
// The admin approval queue is simply status = 'pending', so a separate requests
// table would only duplicate rows and drift from this ledger.
export const transactions = pgTable(
  "transactions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    telegramId: text("telegram_id").notNull(),
    type: text("type").$type<TransactionType>().notNull(),
    status: text("status").$type<TransactionStatus>().notNull().default("pending"),
    amount: integer("amount"),
    method: text("method"),
    reference: text("reference"),
    address: text("address"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_telegram_id_idx").on(t.telegramId),
    index("transactions_status_idx").on(t.status),
  ],
);