export interface TrustSummary {
  profile: string;
  warnings: number;
  critical: number;
}

export function createNullTrustSummary(profile = "dev"): TrustSummary {
  return { profile, warnings: 0, critical: 0 };
}
