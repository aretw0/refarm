import type { NodeContextMetadata } from "../utils/context-metadata.js";
import type { RefarmDoctorRecommendation } from "./doctor.js";

// Exported so a second surface reporting the same fact (`context.ts`'s `refarm context`)
// derives its divergence kind from THIS constant rather than inventing a second name for
// it (found in review: `context.ts` had independently named the identical predicate
// `credential-home-divergence`). The report-vs-diagnostic split stays legitimate — this
// finding carries `action`/`command` for `refarm doctor`, `context.ts`'s carries neither —
// but two names for one fact is not.
export const CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC = "context:home-divergence";
const CONTEXT_HOME_DIVERGENCE_COMMAND = "refarm model current --json";

export function buildContextDoctorRecommendations(
	context: NodeContextMetadata | undefined,
): RefarmDoctorRecommendation[] {
	if (!context || context.homesAligned) return [];
	return [
		{
			diagnostic: CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC,
			severity: "warning",
			summary:
				"REFARM_HOME and SILO_HOME resolve to different homes; credentials and runtime state can diverge.",
			action:
				"Align SILO_HOME and REFARM_HOME for the same operational scope, then re-check model/runtime context.",
			command: CONTEXT_HOME_DIVERGENCE_COMMAND,
		},
	];
}
