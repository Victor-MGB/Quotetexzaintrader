export interface Plan {
  key: string;
  name: string;
  percent: number;
  duration: string;
  min: number;
  max: number | null;
  tagline: string;
}

export const PLANS: Plan[] = [
  { key: "starter", name: "STARTER", percent: 10, duration: "6 Hours", min: 50, max: 150, tagline: "For beginners testing crypto trading." },
  { key: "classic", name: "CLASSIC", percent: 12, duration: "10 Hours", min: 200, max: 350, tagline: "Grow a bigger capital over a longer session." },
  { key: "gold", name: "GOLD", percent: 20, duration: "24 hours", min: 400, max: 550, tagline: "Steady gains while you sleep for 24 hours." },
  { key: "award", name: "AWARD", percent: 25, duration: "4 days", min: 1000, max: null, tagline: "Our top tier. Unlimited deposit, max profit." },
];

export function planByKey(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}