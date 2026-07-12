import type { CapabilityEnvelope, CapabilityInput } from "@refarm.dev/capabilities-v1";

import type { DispatchStep, PlaybookDispatch } from "./types.js";

/**
 * A LOCAL DispatchStep — runs a playbook against IN-PROCESS capabilities, no runtime/sidecar.
 * This is the second impl of the DispatchStep seam: `createDispatchStep` submits to the plugin
 * runtime (WASM, via farmhand) and polls the graph; THIS resolves each `<pluginId>:<verb>` to
 * a registered capability and calls its `run` directly. Same interface, so the SAME playbook
 * runs either way — an example/app that mounts its verbs in-process uses this; the plugin
 * runtime uses the other. Both go "through a verb", the canonical composition unit.
 *
 * The registry is passed structurally as a resolver (pluginId, verb) → descriptor, so this
 * package needs no concrete host/registry type — the consumer adapts its own registry.
 */

/** A runnable verb: a capability descriptor's `run`. Resolved from the host's registry. */
export interface LocalVerb {
	run(input: CapabilityInput): Promise<CapabilityEnvelope> | CapabilityEnvelope;
}

/** Resolve `<pluginId>:<verb>` to a runnable verb, or undefined if the host doesn't have it. */
export type LocalVerbResolver = (pluginId: string, verb: string) => LocalVerb | undefined;

export interface LocalDispatchOptions {
	resolve: LocalVerbResolver;
	/** Map a playbook step's `with` args into the verb's CapabilityInput. By default, args that
	 * look positional-less are passed as `options`, and any `args` key is spread into `args`.
	 * Most verbs read `input.args.<name>`, so the default puts every `with` entry into BOTH
	 * `args` and `options` — verbs pick what they use. Override for a precise mapping. */
	toInput?: (dispatch: PlaybookDispatch) => CapabilityInput;
}

/** Pull the meaningful result out of a capability envelope: the whole envelope IS the result
 * (verbs put their payload in `extra`, flattened onto the envelope by the builders), so we
 * return it as-is — a later step references `{{ saved.<field> }}`. On an error envelope
 * (`ok === false`) we throw so the playbook's abort-on-fail kicks in. */
function resultFromEnvelope(envelope: CapabilityEnvelope): unknown {
	const record = envelope as unknown as Record<string, unknown>;
	if (record.ok === false) {
		const message = typeof record.message === "string" ? record.message : "verb failed";
		throw new Error(message);
	}
	return envelope;
}

function defaultToInput(dispatch: PlaybookDispatch): CapabilityInput {
	// Verbs read args from `input.args`; group sub-actions also read options. Put every `with`
	// entry into both buckets so a step author doesn't need to know a verb's arg/option split.
	return {
		args: { ...dispatch.args },
		options: { ...dispatch.args },
		json: true,
	} as CapabilityInput;
}

/**
 * Build a local DispatchStep from a verb resolver. Feed it to `runPlaybook` to run a playbook
 * against in-process capabilities. A verb the host doesn't expose throws (the step fails).
 */
export function createLocalDispatchStep(options: LocalDispatchOptions): DispatchStep {
	const toInput = options.toInput ?? defaultToInput;
	return async (dispatch: PlaybookDispatch): Promise<unknown> => {
		const verb = options.resolve(dispatch.pluginId, dispatch.verb);
		if (!verb) {
			throw new Error(`UNKNOWN_VERB: no in-process verb "${dispatch.pluginId}:${dispatch.verb}"`);
		}
		const envelope = await verb.run(toInput(dispatch));
		return resultFromEnvelope(envelope);
	};
}
