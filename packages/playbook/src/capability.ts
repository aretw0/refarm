import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capabilities-v1";

import { parsePlaybook } from "./parse.js";
import { runPlaybook } from "./run.js";
import type { DispatchStep, Playbook } from "./types.js";

/**
 * The `playbook:run` capability — surfaces the playbook engine as a dispatchable verb. Because
 * it's a dispatchable verb, it becomes an AGENT TOOL for free on the live capability-tools
 * path (an agent can run a playbook), and a CLI/HTTP verb via the plugin bridge — all through
 * the same one dispatch protocol its own steps use. This is the convergence made concrete:
 * one verb, every surface, on the canonical spine.
 *
 * It is host-agnostic: `dispatch` (how a step runs — createDispatchStep in production) and
 * `loadPlaybook` (how a playbook is fetched by name — from a ledger/file/inline) are injected.
 */

export interface PlaybookRunCapabilityOptions {
	/** How each step's verb is dispatched (createDispatchStep wired to the host in production). */
	dispatch: DispatchStep;
	/** Resolve a playbook by name/ref (e.g. read `.dgk/<name>.playbook.json`). Returns the raw
	 * document (validated by the verb) or null if not found. */
	loadPlaybook: (ref: string) => Promise<unknown | null> | (unknown | null);
	/** Verb name (default "playbook-run" — CLI/agent friendly, no colon in the descriptor name). */
	name?: string;
	/** HTTP path (default "/playbook/run"). */
	httpPath?: string;
}

/** Build the `playbook:run` capability descriptor. */
export function createPlaybookRunCapability(
	options: PlaybookRunCapabilityOptions,
): CapabilityDescriptor {
	const name = options.name ?? "playbook-run";
	return {
		name,
		summary: "Run a declarative playbook — sequence verbs, threading each step's output forward",
		args: [{ name: "playbook", required: true }],
		options: [
			{
				name: "input",
				kind: "string",
				summary: "JSON object passed to the playbook as {{ input.… }}",
			},
			{ name: "continue-on-error", kind: "boolean", summary: "Run later steps despite a failure" },
		],
		transports: {
			cli: {},
			repl: {},
			http: { method: "POST", path: options.httpPath ?? "/playbook/run" },
			// A playbook only calls verbs the runtime already exposes (each step goes through the
			// same dispatch), so surfacing it as an agent tool grants no new power — it composes
			// existing verbs. The agent can run a playbook to orchestrate a multi-step job.
			agent: { tool: true, toolName: "playbook_run" },
		},
		renderers: { tui: { section: "playbook" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const ref = String(input.args.playbook ?? "");
			if (!ref) {
				return buildJsonErrorEnvelope({
					command: name,
					operation: "run",
					error: "no_playbook",
					message: "Pass a playbook name/ref to run.",
					nextAction: `${name} <playbook>`,
				});
			}

			const raw = await options.loadPlaybook(ref);
			if (raw == null) {
				return buildJsonErrorEnvelope({
					command: name,
					operation: "run",
					error: "not_found",
					message: `No playbook "${ref}".`,
					nextAction: `Check the playbook name/path for "${ref}".`,
				});
			}

			const parsed = parsePlaybook(raw);
			if (!parsed.ok || !parsed.playbook) {
				return buildJsonErrorEnvelope({
					command: name,
					operation: "run",
					error: "invalid_playbook",
					message: `Playbook "${ref}" is invalid: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
					nextAction: "Fix the playbook and re-run.",
				});
			}

			const playbook: Playbook = parsed.playbook;
			const stepInput = parseInputOption(input.options.input);
			const result = await runPlaybook(playbook, {
				dispatch: options.dispatch,
				input: stepInput,
				continueOnError: input.options["continue-on-error"] === true,
			});

			const extra = {
				playbook: playbook.name,
				ok: result.ok,
				steps: result.steps,
				bindings: result.bindings,
			};
			if (result.ok) {
				return buildJsonSuccessEnvelope({ command: name, operation: "run", extra });
			}
			const failed = result.steps.find((s) => !s.ok);
			return buildJsonErrorEnvelope({
				command: name,
				operation: "run",
				error: "playbook_failed",
				message: `Playbook "${playbook.name}" failed${failed ? ` at ${failed.verb}: ${failed.error}` : ""}`,
				nextAction: "Inspect the step results and re-run.",
				extra,
			});
		},
	};
}

/** Parse the `--input` option (a JSON object) into the playbook's initial input. */
function parseInputOption(value: unknown): Record<string, unknown> {
	if (value == null) return {};
	if (typeof value === "object") return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
		} catch {
			return {};
		}
	}
	return {};
}
