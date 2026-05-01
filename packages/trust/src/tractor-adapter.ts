import type { TrustSummary } from "./index.js";

interface TractorLike {
  defaultSecurityMode: string;
}

export function createTrustSummaryFromTractor(tractor: TractorLike): TrustSummary {
  return {
    profile: tractor.defaultSecurityMode,
    warnings: 0,
    critical: 0,
  };
}
