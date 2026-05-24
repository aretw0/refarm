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

export interface JsonSuccessEnvelopeInput<TExtra extends object = object>
	extends JsonErrorEnvelopeContext {
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
	extra?: TExtra;
}

export interface JsonErrorEnvelopeInput<TExtra extends object = object>
	extends JsonErrorEnvelopeContext {
	error: string;
	message?: string;
	nextAction: string;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
	extra?: TExtra;
}

export type JsonErrorEnvelope<TExtra extends object = object> = TExtra &
	JsonErrorEnvelopeContext & {
		ok: false;
		error: string;
		message?: string;
		nextAction: string;
		nextActions: string[];
		nextCommand: string | null;
		nextCommands: string[];
	};

export type JsonSuccessEnvelope<TExtra extends object = object> = TExtra &
	JsonErrorEnvelopeContext & {
		ok: true;
		nextAction: string | null;
		nextActions: string[];
		nextCommand: string | null;
		nextCommands: string[];
	};

export function buildJsonSuccessEnvelope<TExtra extends object = object>(
	input: JsonSuccessEnvelopeInput<TExtra> = {},
): JsonSuccessEnvelope<TExtra> {
	const {
		command,
		operation,
		nextAction,
		nextActions,
		nextCommand,
		nextCommands,
		extra,
	} = input;
	const resolvedNextActions = nextActions ?? (nextAction ? [nextAction] : []);
	const resolvedNextCommands =
		nextCommands ?? (nextCommand ? [nextCommand] : []);
	return {
		...(extra ?? {}),
		...(command ? { command } : {}),
		...(operation ? { operation } : {}),
		ok: true,
		nextAction: nextAction ?? resolvedNextActions[0] ?? null,
		nextActions: resolvedNextActions,
		nextCommand: nextCommand ?? resolvedNextCommands[0] ?? null,
		nextCommands: resolvedNextCommands,
	} as JsonSuccessEnvelope<TExtra>;
}

export function buildJsonErrorEnvelope<TExtra extends object = object>(
	input: JsonErrorEnvelopeInput<TExtra>,
): JsonErrorEnvelope<TExtra> {
	const {
		command,
		operation,
		error,
		message,
		nextAction,
		nextActions,
		nextCommand,
		nextCommands,
		extra,
	} = input;
	const resolvedNextCommands =
		nextCommands ?? (nextCommand ? [nextCommand] : []);
	return {
		...(extra ?? {}),
		...(command ? { command } : {}),
		...(operation ? { operation } : {}),
		ok: false,
		error,
		...(message ? { message } : {}),
		nextAction,
		nextActions: nextActions ?? [nextAction],
		nextCommand: nextCommand ?? resolvedNextCommands[0] ?? null,
		nextCommands: resolvedNextCommands,
	} as JsonErrorEnvelope<TExtra>;
}
