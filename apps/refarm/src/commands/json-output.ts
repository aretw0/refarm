export function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function printJson(value: unknown): void {
	console.log(formatJson(value));
}

export interface JsonErrorEnvelopeContext {
	command?: string;
	operation?: string;
}

export interface JsonErrorEnvelopeInput extends JsonErrorEnvelopeContext {
	error: string;
	message?: string;
	nextAction: string;
	nextActions?: string[];
}

export function buildJsonErrorEnvelope(input: JsonErrorEnvelopeInput) {
	const { command, operation, error, message, nextAction, nextActions } = input;
	return {
		...(command ? { command } : {}),
		...(operation ? { operation } : {}),
		ok: false,
		error,
		...(message ? { message } : {}),
		nextAction,
		nextActions: nextActions ?? [nextAction],
	};
}
