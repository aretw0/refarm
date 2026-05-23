export type DiagnosticRecommendationSeverity = "failure" | "warning" | "info";

export interface DiagnosticRecommendation {
	diagnostic: string;
	summary: string;
	action: string;
	severity?: DiagnosticRecommendationSeverity;
	target?: string;
}

export function diagnosticNextActions(
	recommendations: DiagnosticRecommendation[],
): string[] {
	const seen = new Set<string>();
	const actions: string[] = [];
	for (const recommendation of recommendations) {
		if (recommendation.severity === "info") continue;
		const action = recommendation.action.trim();
		if (!action || seen.has(action)) continue;
		seen.add(action);
		actions.push(action);
	}
	return actions;
}
