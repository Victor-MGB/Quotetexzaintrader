export type AuthFlow = "register-email" | "register-password" | "register-confirm" | "login";

export interface AuthEntry {
  flow: AuthFlow;
  email?: string;
  password?: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const flows = new Map<string, AuthEntry>();

export function getFlow(telegramId: string): AuthEntry | null {
  const entry = flows.get(telegramId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    flows.delete(telegramId);
    return null;
  }
  return entry;
}

export function setFlow(telegramId: string, entry: Omit<AuthEntry, "expiresAt">): void {
  flows.set(telegramId, { ...entry, expiresAt: Date.now() + TTL_MS });
}

export function clearFlow(telegramId: string): void {
  flows.delete(telegramId);
}