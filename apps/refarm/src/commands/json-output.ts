import { normalizeHandoffValues } from "./command-handoff.js";

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

function normalizeHandoffList(
	singular: string | null | undefined,
	plural: string[] | undefined,
	options: { singularFirst: boolean },
): string[] {
	const singularValue =
		typeof singular === "string" && singular.trim().length > 0
			? singular.trim()
			: null;
	const pluralValues = normalizeHandoffValues(plural ?? []);
	const values = singularValue && options.singularFirst
		? [singularValue, ...pluralValues]
		: pluralValues.length > 0
			? pluralValues
			: singularValue
				? [singularValue]
				: [];
	return normalizeHandoffValues(values);
}

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
	const resolvedNextActions = normalizeHandoffList(nextAction, nextActions, {
		singularFirst: false,
	});
	const resolvedNextCommands = normalizeHandoffList(nextCommand, nextCommands, {
		singularFirst: true,
	});
	const resolvedNextAction =
		typeof nextAction === "string" && nextAction.trim().length > 0
			? nextAction.trim()
			: resolvedNextActions[0] ?? null;
	return {
		...(extra ?? {}),
		...(command ? { command } : {}),
		...(operation ? { operation } : {}),
		ok: true,
		nextAction: resolvedNextAction,
		nextActions: resolvedNextActions,
		nextCommand: resolvedNextCommands[0] ?? null,
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
	const resolvedNextActions = normalizeHandoffList(nextAction, nextActions, {
		singularFirst: false,
	});
	const resolvedNextCommands = normalizeHandoffList(nextCommand, nextCommands, {
		singularFirst: true,
	});
	const resolvedNextAction =
		typeof nextAction === "string" && nextAction.trim().length > 0
			? nextAction.trim()
			: resolvedNextActions[0] ?? nextAction;
	return {
		...(extra ?? {}),
		...(command ? { command } : {}),
		...(operation ? { operation } : {}),
		ok: false,
		error,
		...(message ? { message } : {}),
		nextAction: resolvedNextAction,
		nextActions: resolvedNextActions,
		nextCommand: resolvedNextCommands[0] ?? null,
		nextCommands: resolvedNextCommands,
	} as JsonErrorEnvelope<TExtra>;
}
