export interface Plan {
  key: string;
  name: string;
  percent: number;
  duration: string;
  min: number;
  max: number | null;
}

export const PLANS: Plan[] = [
  { key: "starter", name: "STARTER", percent: 10, duration: "6 Hours", min: 50, max: 150 },
  { key: "classic", name: "CLASSIC", percent: 12, duration: "10 Hours", min: 200, max: 350 },
  { key: "gold", name: "GOLD", percent: 20, duration: "24 hours", min: 400, max: 550 },
  { key: "award", name: "AWARD", percent: 25, duration: "4 days", min: 1000, max: null },
];

export function planByKey(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}