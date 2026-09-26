import { eq } from "drizzle-orm";
import { env } from "./config.js";
import { db } from "./db.js";
import { logger } from "./logger.js";
import { settings } from "../db/schema.js";
import { sanitizeAddress, WALLETS, type WalletMethod } from "../modules/main/content.js";

const envAddresses: Record<WalletMethod["envKey"], string | undefined> = {
  DEPOSIT_BTC: env.DEPOSIT_BTC,
  DEPOSIT_TRC20: env.DEPOSIT_TRC20,
  DEPOSIT_TRX: env.DEPOSIT_TRX,
  DEPOSIT_ETH: env.DEPOSIT_ETH,
};

export async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

const envKeys = Object.keys(envAddresses) as WalletMethod["envKey"][];

export function envAddress(wallet: WalletMethod): string | null {
  return sanitizeAddress(wallet, envAddresses[wallet.envKey]);
}

export interface DepositStatus {
  wallet: WalletMethod;
  address: string | null;
  source: "env" | "database" | "unset";
  raw: string | null;
  valid: boolean;
}

export async function describeDeposit(wallet: WalletMethod): Promise<DepositStatus> {
  const rawEnv = envAddresses[wallet.envKey]?.trim() ?? "";
  const validEnv = envAddress(wallet);
  if (validEnv) {
    return { wallet, address: validEnv, source: "env", raw: rawEnv, valid: true };
  }

  const rawStored = (await getSetting(wallet.settingKey))?.trim() ?? "";
  const validStored = sanitizeAddress(wallet, rawStored);
  if (validStored) {
    return { wallet, address: validStored, source: "database", raw: rawStored, valid: true };
  }

  return {
    wallet,
    address: null,
    source: "unset",
    raw: rawEnv || rawStored || null,
    valid: false,
  };
}

export async function depositAddress(wallet: WalletMethod): Promise<string | null> {
  return (await describeDeposit(wallet)).address;
}

export function describeDepositStatus(status: DepositStatus): string {
  const { wallet, address, source, raw, valid } = status;
  if (valid && address) return `${wallet.icon} ${wallet.asset.padEnd(4)} ${address}  (${source})`;

  if (source === "unset" && raw) {
    return `${wallet.icon} ${wallet.asset.padEnd(4)} REJECTED — "${raw}" is not a valid ${wallet.asset} address on ${wallet.network}`;
  }
  return `${wallet.icon} ${wallet.asset.padEnd(4)} not set — no ${wallet.envKey} and nothing saved with /setaddress`;
}

export function warnUnknownEnvKeys(keys: string[]): void {
  if (!keys.length) return;
  logger.warn(
    { unknown: keys, expected: envKeys },
    "ignoring unrecognised deposit env var — check the spelling, it will not be used",
  );
}

export async function logDepositAddresses(): Promise<void> {
  const unknown = Object.keys(process.env).filter(
    (key) => /^DEPOSIT_/.test(key) && !envKeys.includes(key as WalletMethod["envKey"]),
  );
  warnUnknownEnvKeys(unknown);

  const lines = await Promise.all(
    WALLETS.map(async (wallet) => describeDepositStatus(await describeDeposit(wallet))),
  );
  const broken = lines.filter((line) => line.includes("REJECTED") || line.includes("not set"));
  logger.info({ depositAddresses: lines }, "deposit address status");
  if (broken.length) {
    logger.warn({ broken }, "some deposit methods will show the 'ask an admin' screen");
  }
}
