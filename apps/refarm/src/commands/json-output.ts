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

export interface JsonErrorEnvelopeInput<TExtra extends object = object>
	extends JsonErrorEnvelopeContext {
	error: string;
	message?: string;
	nextAction: string;
	nextActions?: string[];
	extra?: TExtra;
}

export type JsonErrorEnvelope<TExtra extends object = object> = TExtra &
	JsonErrorEnvelopeContext & {
		ok: false;
		error: string;
		message?: string;
		nextAction: string;
		nextActions: string[];
	};

export function buildJsonErrorEnvelope<TExtra extends object = object>(
	input: JsonErrorEnvelopeInput<TExtra>,
): JsonErrorEnvelope<TExtra> {
	const { command, operation, error, message, nextAction, nextActions, extra } =
		input;
	return {
		...(extra ?? {}),
		...(command ? { command } : {}),
		...(operation ? { operation } : {}),
		ok: false,
		error,
		...(message ? { message } : {}),
		nextAction,
		nextActions: nextActions ?? [nextAction],
	} as JsonErrorEnvelope<TExtra>;
}
