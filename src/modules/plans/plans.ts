export interface Plan {
  key: string;
  name: string;
  percent: number;
  duration: string;
  min: number;
  max: number | null;
  message: string;
}

export const PLANS: Plan[] = [
  {
    key: "starter",
    name: "STARTER",
    percent: 10,
    duration: "6 Hours",
    min: 50,
    max: 150,
    message:
      "Built for first-time investors. Deposit from just $50 and our team trades crypto on your behalf — you get 10% profit credited after 6 hours. Perfect to learn how the platform works before going bigger.",
  },
  {
    key: "classic",
    name: "CLASSIC",
    percent: 12,
    duration: "10 Hours",
    min: 200,
    max: 350,
    message:
      "Grows your funds faster. We put your $200–$350 capital to work for 10 hours and credit 12% when the session closes. Ideal for steady short-session gains.",
  },
  {
    key: "gold",
    name: "GOLD",
    percent: 20,
    duration: "24 hours",
    min: 400,
    max: 550,
    message:
      "A full 24-hour trading session. Deposit $400–$550, our traders run the market overnight while you rest, and you wake up to 20% profit added to your balance.",
  },
  {
    key: "award",
    name: "AWARD",
    percent: 25,
    duration: "4 days",
    min: 1000,
    max: null,
    message:
      "Our top package for serious investors. Deposit from $1,000 (no upper limit) and receive 25% return after 4 days. Maximum profit, minimum effort.",
  },
];

export function planByKey(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}