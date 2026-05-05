export interface TrustSummary {
  profile: string;
  warnings: number;
  critical: number;
}

export function createNullTrustSummary(profile = "dev"): TrustSummary {
  return { profile, warnings: 0, critical: 0 };
}

export { createTrustSummaryFromTractor } from "./tractor-adapter.js";
