import { eq } from "drizzle-orm";
import { env } from "./config.js";
import { db } from "./db.js";
import { logger } from "./logger.js";
import { settings } from "../db/schema.js";
import { sanitizeAddress, type WalletMethod } from "../modules/main/content.js";

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

export function envAddress(wallet: WalletMethod): string | null {
  return sanitizeAddress(wallet, envAddresses[wallet.envKey]);
}

export async function depositAddress(wallet: WalletMethod): Promise<string | null> {
  const fromEnv = envAddress(wallet);
  if (fromEnv) return fromEnv;

  const raw = envAddresses[wallet.envKey];
  if (raw?.trim()) {
    logger.warn({ envKey: wallet.envKey }, "deposit address in env is not a valid address; ignoring it");
  }

  const stored = await getSetting(wallet.settingKey);
  const address = sanitizeAddress(wallet, stored);
  if (stored && !address) {
    logger.warn({ settingKey: wallet.settingKey }, "stored deposit address is not a valid address; ignoring it");
  }
  return address;
}
