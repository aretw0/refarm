export type DiagnosticRecommendationSeverity = "failure" | "warning" | "info";

export interface DiagnosticRecommendation {
	diagnostic: string;
	summary: string;
	action: string;
	command?: string;
	severity?: DiagnosticRecommendationSeverity;
	target?: string;
}

export interface DiagnosticNextActionPayload<TExtra extends object = object> {
	ok: boolean;
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
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

export function diagnosticNextCommands(
	recommendations: DiagnosticRecommendation[],
): string[] {
	const seen = new Set<string>();
	const commands: string[] = [];
	for (const recommendation of recommendations) {
		if (recommendation.severity === "info") continue;
		const command = recommendation.command?.trim();
		if (!command || seen.has(command)) continue;
		seen.add(command);
		commands.push(command);
	}
	return commands;
}

function normalizeDiagnosticHandoffs(values: string[]): string[] {
	return Array.from(
		new Set(
			values
				.map((value) => value.trim())
				.filter((value) => value.length > 0),
		),
	);
}

export function buildDiagnosticNextActionPayload<TExtra extends object = object>(
	input: { ok: boolean; nextActions: string[]; nextCommands?: string[] } & TExtra,
): DiagnosticNextActionPayload<TExtra> & TExtra {
	const { ok, nextActions, nextCommands, ...extra } = input;
	const resolvedNextActions = normalizeDiagnosticHandoffs(nextActions);
	const resolvedNextCommands = normalizeDiagnosticHandoffs(nextCommands ?? []);
	const [nextAction] = resolvedNextActions;
	const [nextCommand] = resolvedNextCommands;
	return {
		ok,
		nextAction: nextAction ?? null,
		nextActions: resolvedNextActions,
		nextCommand: nextCommand ?? null,
		nextCommands: resolvedNextCommands,
		...(extra as TExtra),
	};
}
