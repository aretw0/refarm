export type DiagnosticRecommendationSeverity = "failure" | "warning" | "info";

export interface DiagnosticRecommendation {
	diagnostic: string;
	summary: string;
	action: string;
	severity?: DiagnosticRecommendationSeverity;
	target?: string;
}

export interface DiagnosticNextActionPayload<TExtra extends object = object> {
	ok: boolean;
	nextAction: string | null;
	nextActions: string[];
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

export function buildDiagnosticNextActionPayload<TExtra extends object = object>(
	input: { ok: boolean; nextActions: string[] } & TExtra,
): DiagnosticNextActionPayload<TExtra> & TExtra {
	const [nextAction] = input.nextActions;
	const { ok, nextActions, ...extra } = input;
	return {
		ok,
		nextAction: nextAction ?? null,
		nextActions,
		...(extra as TExtra),
	};
}
