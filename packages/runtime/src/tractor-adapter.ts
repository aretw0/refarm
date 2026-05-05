import type { RuntimeSummary } from "./index.js";

interface TractorLike {
  namespace: string;
}

export function createRuntimeSummaryFromTractor(tractor: TractorLike): RuntimeSummary {
  return {
    ready: true,
    namespace: tractor.namespace,
    databaseName: tractor.namespace,
  };
}
