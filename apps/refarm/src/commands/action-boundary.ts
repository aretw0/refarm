import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import chalk from "chalk";

/**
 * THE ACTION BOUNDARY — the one place a command's internal `throw` stops being one.
 *
 * An operator-facing command must never surface a raw Node stack trace, and a `--json`
 * consumer must get a parseable envelope on the error path too. `commands/intention.ts`
 * (0534737b) and `commands/workspace.ts` each grew their own copy of this after the
 * refusal-conformance harness found the class; this is that copy, extracted, so the next
 * command that needs it imports instead of re-deriving.
 *
 * The rule it enforces, stated once so every caller inherits it:
 *
 *   `ok` means "the command did its job", not "the answer was yes."
 *
 * So this module is for the FAILURE path only — bad input, an unreachable dependency the
 * command needed, a refusal. A status command that successfully reports that something is
 * down did its job: `ok: true`, exit 0, subject state in its own field. See
 * `docs/NAMING_REGISTRY.md` § "`ok` semantics".
 *
 * `intention.ts` and `workspace.ts` still carry their own copies; they predate this module
 * and can migrate when they are next touched.
 */

/**
 * A refusal the command raised deliberately, carrying the envelope `error` code and the
 * operator hint that belong to it. Throw this from a validation helper and the boundary
 * renders it; throw anything else and the boundary still refuses, using the caller's
 * fallback code.
 */
export class CommandRefusal extends Error {
	readonly code: string;
	/** The dim second line in text mode; the envelope's `nextAction` in JSON mode. */
	readonly hint: string | undefined;

	constructor(code: string, message: string, hint?: string) {
		super(message);
		this.name = "CommandRefusal";
		this.code = code;
		this.hint = hint;
	}
}

/** Where a refusal of this command sends the operator next. */
export interface RefusalHandoff {
	/** Envelope `command` field, e.g. `"config"`. */
	command: string;
	/** Envelope `operation` field, e.g. `"set"`. */
	operation: string;
	/** Envelope `error` code used when the thrown value is not a {@link CommandRefusal}. */
	error: string;
	/** What the operator should do, when the refusal does not carry its own hint. */
	nextAction: string;
	/** The executable handoff. Never empty — a refusal with no way forward is a dead end. */
	nextCommand: string;
	nextCommands?: string[];
}

/**
 * Render a refusal: an envelope under `--json`, one calm line (plus its hint) otherwise,
 * and a non-zero exit in BOTH modes — the exit code must agree with `ok`, or a
 * `set -e` script reads a refusal as success.
 */
export function reportRefusal(error: unknown, json: boolean, handoff: RefusalHandoff): void {
	const refusal = error instanceof CommandRefusal ? error : undefined;
	const message = error instanceof Error ? error.message : String(error);
	const hint = refusal?.hint ?? handoff.nextAction;
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: handoff.command,
				operation: handoff.operation,
				error: refusal?.code ?? handoff.error,
				message,
				nextAction: hint,
				nextCommand: handoff.nextCommand,
				nextCommands: handoff.nextCommands ?? [handoff.nextCommand],
			}),
		);
	} else {
		console.error(chalk.red(`✗  ${message}`));
		console.error(chalk.dim(`   ${hint}`));
	}
	process.exitCode = 1;
}

/**
 * Wrap a Commander action so a thrown error becomes the repo's refusal shape instead of an
 * uncaught exception. The handler is not rewritten and its `throw`s stay exactly where they
 * are — this only decides what they mean at the edge.
 */
export function guardedAction<TArgs extends unknown[]>(
	resolve: (...args: TArgs) => { json: boolean } & RefusalHandoff,
	handler: (...args: TArgs) => void | Promise<void>,
): (...args: TArgs) => Promise<void> {
	return async (...args: TArgs) => {
		try {
			await handler(...args);
		} catch (error) {
			const { json, ...handoff } = resolve(...args);
			reportRefusal(error, json, handoff);
		}
	};
}
