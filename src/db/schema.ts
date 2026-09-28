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

export const ACCESS_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

// One row per person who has asked for access, keyed by telegram id so repeated
// /start taps update the same request instead of stacking up duplicates.
//
// It is a table rather than an in-memory Set because the request is only useful
// if it survives a restart: a member who taps Start while the bot is down, or
// whose notification never reached an admin, would otherwise wait forever with
// nobody aware they were waiting. `notifiedAt` is what keeps a member from
// re-pinging every admin on every keystroke, and `status` is what the Approve and
// Reject buttons move.
export const accessRequests = pgTable("access_requests", {
  telegramId: text("telegram_id").primaryKey(),
  username: text(),
  firstName: text(),
  lastName: text(),
  status: text("status").$type<AccessRequestStatus>().notNull().default("pending"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  notifiedAt: timestamp("notified_at"),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by"),
});

export const TESTIMONY_STATUSES = ["pending", "published", "deleted"] as const;
export type TestimonyStatus = (typeof TESTIMONY_STATUSES)[number];

// Testimonies are social proof, so they live in the database rather than as a
// hardcoded list in content: members submit their own, an admin publishes them,
// and either kind can be withdrawn later without a redeploy.
//
// "deleted" is a soft state instead of a removed row. Losing a published
// testimonial to a mis-click is then a reversal rather than a re-typing job, and
// the record of who submitted it survives for as long as the row does.
//
// `media` stores a filename from the library in src/pictures or src/videos rather
// than a Telegram file_id, because a file_id is only valid for the bot that
// uploaded it and would not survive a token change. A filename also means a
// missing file degrades to a text-only card instead of a broken one.
export const testimonies = pgTable(
  "testimonies",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    message: text("message").notNull(),
    plan: text("plan"),
    media: text("media"),
    status: text("status").$type<TestimonyStatus>().notNull().default("pending"),
    submittedBy: text("submitted_by").notNull(),
    byAdmin: boolean("by_admin").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("testimonies_status_idx").on(t.status),
    index("testimonies_submitted_by_idx").on(t.submittedBy),
  ],
);

// "adjustment" is a manual correction an admin applies from the user list. It
// is never pending, so it never reaches the approval queue; the amount is
// signed and always equals the change the balance actually moved by.
export const TRANSACTION_TYPES = ["deposit", "withdrawal", "adjustment"] as const;
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