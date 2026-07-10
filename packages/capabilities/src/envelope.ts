/**
 * The neutral result envelope — the shape a capability's `run()` returns and the
 * helpers to emit it. A JSON envelope is surface-agnostic: web, agent, and http
 * read `ok`/`nextAction`/`nextCommands` the same way, so it belongs to the
 * capability MODEL, not to any one surface.
 *
 * This is the part of the old `@refarm.dev/cli/json-output` that is genuinely
 * neutral (`formatJson`/`printJson` + the envelope types). The `build*` helpers
 * that normalize shell handoff values stay in `@refarm.dev/cli` (they depend on
 * shell-quoting primitives that are CLI-specific), and re-export these types.
 */

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

export interface JsonSuccessEnvelopeInput<
	TExtra extends object = object,
> extends JsonErrorEnvelopeContext {
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
	extra?: TExtra;
}

export interface JsonErrorEnvelopeInput<
	TExtra extends object = object,
> extends JsonErrorEnvelopeContext {
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

/**
 * Normalize a handoff singular+plural into a de-duplicated, trimmed list.
 * The neutral core of what the CLI's json-output does: it drops empties and
 * dedupes. `@refarm.dev/cli` layers shell-quoting on top for command handoffs;
 * the envelope shape itself needs only this list normalization.
 */
function normalizeHandoffList(
	singular: string | null | undefined,
	plural: string[] | undefined,
	options: { singularFirst: boolean },
): string[] {
	const singularValue =
		typeof singular === "string" && singular.trim().length > 0 ? singular.trim() : null;
	const pluralValues = Array.from(
		new Set((plural ?? []).map((v) => v.trim()).filter((v) => v.length > 0)),
	);
	const values =
		singularValue && options.singularFirst
			? [singularValue, ...pluralValues]
			: pluralValues.length > 0
				? pluralValues
				: singularValue
					? [singularValue]
					: [];
	return Array.from(new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)));
}

/** Build a success envelope from a partial input, resolving handoff lists. */
export function buildJsonSuccessEnvelope<TExtra extends object = object>(
	input: JsonSuccessEnvelopeInput<TExtra> = {},
): JsonSuccessEnvelope<TExtra> {
	const { command, operation, nextAction, nextActions, nextCommand, nextCommands, extra } = input;
	const resolvedNextActions = normalizeHandoffList(nextAction, nextActions, {
		singularFirst: false,
	});
	const resolvedNextCommands = normalizeHandoffList(nextCommand, nextCommands, {
		singularFirst: true,
	});
	const resolvedNextAction =
		typeof nextAction === "string" && nextAction.trim().length > 0
			? nextAction.trim()
			: (resolvedNextActions[0] ?? null);
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

/** Build an error envelope from an input, resolving handoff lists. */
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
			: (resolvedNextActions[0] ?? nextAction);
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
