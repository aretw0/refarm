import type { NodeContextMetadata } from "../utils/context-metadata.js";
import type { RefarmDoctorRecommendation } from "./doctor.js";

const CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC = "context:home-divergence";
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
