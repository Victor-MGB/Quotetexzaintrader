export interface WalletMethod {
  key: string;
  icon: string;
  label: string;
  settingKey: string;
  envKey: "DEPOSIT_BTC" | "DEPOSIT_TRC20" | "DEPOSIT_TRX" | "DEPOSIT_ETH";
  pattern: RegExp;
  network: string;
  asset: string;
  speed: string;
}

export const WALLETS: WalletMethod[] = [
  {
    key: "btc",
    icon: "₿",
    label: "Bitcoin",
    settingKey: "deposit_btc",
    envKey: "DEPOSIT_BTC",
    pattern: /^(1[1-9A-HJ-NP-Za-km-z]{25,34}|3[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39}|BC1[QRZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{39})$/,
    network: "Bitcoin",
    asset: "BTC",
    speed: "1–3 network confirmations",
  },
  {
    key: "trc20",
    icon: "💵",
    label: "USDT (TRC20)",
    settingKey: "deposit_trc20",
    envKey: "DEPOSIT_TRC20",
    pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    network: "Tron (TRC20)",
    asset: "USDT",
    speed: "1 confirmation, usually under a minute",
  },
  {
    key: "trx",
    icon: "🪙",
    label: "Tron (TRX)",
    settingKey: "deposit_trx",
    envKey: "DEPOSIT_TRX",
    pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    network: "Tron",
    asset: "TRX",
    speed: "1 confirmation, usually under a minute",
  },
  {
    key: "eth",
    icon: "◆",
    label: "Ethereum (ETH)",
    settingKey: "deposit_eth",
    envKey: "DEPOSIT_ETH",
    pattern: /^0x[0-9a-fA-F]{40}$/,
    network: "ERC20",
    asset: "ETH",
    speed: "3–5 network confirmations",
  },
];

export function sanitizeAddress(wallet: WalletMethod, value: string | null | undefined): string | null {
  const address = value?.trim() ?? "";
  if (!address) return null;
  return wallet.pattern.test(address) ? address : null;
}

export function walletByKey(key: string): WalletMethod | undefined {
  return WALLETS.find((w) => w.key === key);
}

export const MIN_WITHDRAWAL = 10;

export interface Promo {
  key: string;
  icon: string;
  title: string;
  reward: string;
  requirement: string;
  tiers?: Array<[deposit: string, payout: string]>;
}

export const PROMOS: Promo[] = [
  {
    key: "investment-promo",
    icon: "💎",
    title: "Investment Promo",
    reward: "💸 <b>2× your deposit</b>, credited within 12 hours.",
    requirement: "📌 Minimum investment $500. Tiers continue beyond the list above.",
    tiers: [
      ["$500", "$1,000"],
      ["$1,000", "$2,000"],
      ["$2,000", "$4,000"],
      ["$4,000", "$8,000"],
      ["$5,000", "$10,000"],
      ["$10,000", "$20,000"],
    ],
  },
  {
    key: "first-deposit",
    icon: "🎁",
    title: "First Deposit Bonus",
    reward: "+5% on top of your first plan return",
    requirement: "Fund any plan within your first 24 hours as a new member.",
  },
  {
    key: "referral",
    icon: "🤝",
    title: "Referral Bonus",
    reward: "$10 credited for every member you bring",
    requirement: "Your friend must complete a deposit and their first plan session.",
  },
  {
    key: "deposit-size",
    icon: "📈",
    title: "Large Deposit Bonus",
    reward: "Extra 2% on the GOLD plan for deposits of $500+",
    requirement: "Single deposit of $500 or more into the GOLD plan.",
  },
  {
    key: "loyalty",
    icon: "🏅",
    title: "Loyalty Reward",
    reward: "Priority profit withdrawal and a dedicated support line",
    requirement: "Three completed plan sessions with no failed payment.",
  },
];

export function promoByKey(key: string): Promo | undefined {
  return PROMOS.find((p) => p.key === key);
}

export interface ReportCategory {
  key: string;
  icon: string;
  label: string;
  prompt: string;
}

export interface Testimony {
  key: string;
  member: string;
  plan: string;
  message: string;
}

export const TESTIMONIES: Testimony[] = [
  {
    key: "placeholder-1",
    member: "Placeholder entry",
    plan: "STARTER",
    message: "Replace this with a real, consented member quote about their plan session.",
  },
  {
    key: "placeholder-2",
    member: "Placeholder entry",
    plan: "GOLD",
    message: "Replace this with a real, consented member quote about their payout timing.",
  },
  {
    key: "placeholder-3",
    member: "Placeholder entry",
    plan: "CLASSIC",
    message: "Replace this with a real, consented member quote about their support experience.",
  },
];

export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    key: "deposit",
    icon: "💳",
    label: "Deposit issue",
    prompt: "Describe the deposit problem and include the transaction ID if you have one.",
  },
  {
    key: "withdrawal",
    icon: "🏦",
    label: "Withdrawal delay",
    prompt: "Tell us how much you requested, when, and to which wallet.",
  },
  {
    key: "plan",
    icon: "💼",
    label: "Plan / profit issue",
    prompt: "Tell us which plan you ran and what went wrong with your return.",
  },
  {
    key: "account",
    icon: "🔐",
    label: "Account access",
    prompt: "Tell us what happened with your login or account.",
  },
  {
    key: "fraud",
    icon: "🚨",
    label: "Suspected fraud",
    prompt: "Describe the suspicious activity in as much detail as you can.",
  },
  {
    key: "other",
    icon: "📝",
    label: "Something else",
    prompt: "Tell us what you need help with.",
  },
];

export function reportCategoryByKey(key: string): ReportCategory | undefined {
  return REPORT_CATEGORIES.find((c) => c.key === key);
}
