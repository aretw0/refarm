import { interpolate } from "./interpolate.js";
import type {
	DispatchStep,
	Playbook,
	PlaybookDispatch,
	PlaybookRunResult,
	PlaybookStep,
	PlaybookStepResult,
} from "./types.js";

export interface RunPlaybookOptions {
	/** How each step's verb is actually dispatched (canonical protocol in prod; fake in tests). */
	dispatch: DispatchStep;
	/** Initial input, referenceable as `{{ input.… }}` from step one. */
	input?: Record<string, unknown>;
	/** Continue after a failed step instead of aborting (default false — abort-on-fail, like
	 * delegate_chain). A skipped step is still reported. */
	continueOnError?: boolean;
}

/** Split a `<pluginId>:<verb>` step verb. Assumes it passed parse validation. */
function splitVerb(verb: string): { pluginId: string; verb: string } {
	const idx = verb.indexOf(":");
	return { pluginId: verb.slice(0, idx), verb: verb.slice(idx + 1) };
}

function stepId(step: PlaybookStep, index: number): string {
	return step.id ?? `step-${index}`;
}

/**
 * Run a playbook: for each step, interpolate its `with` against the live scope (the initial
 * input plus every prior step's saved result — this is the THREADING), dispatch the verb
 * through the injected `dispatch`, save the result under `saveAs`, and carry it forward. A
 * failed step aborts the run (remaining steps reported as skipped) unless `continueOnError`.
 *
 * The interpreter is pure and canonical: it emits `PlaybookDispatch` requests (the shape
 * `buildDispatchEffort` takes) and never runs a verb itself. Swap `dispatch` for the real
 * dispatch-and-read-back and the same playbook runs on the live runtime.
 */
export async function runPlaybook(
	playbook: Playbook,
	options: RunPlaybookOptions,
): Promise<PlaybookRunResult> {
	const bindings: Record<string, unknown> = {};
	const scope: Record<string, unknown> = { input: options.input ?? {} };
	const results: PlaybookStepResult[] = [];
	let aborted = false;

	for (let index = 0; index < playbook.steps.length; index += 1) {
		const step = playbook.steps[index]!;
		const id = stepId(step, index);

		if (aborted) {
			results.push({ id, verb: step.verb, ok: false, error: "skipped: a prior step failed" });
			continue;
		}

		const { pluginId, verb } = splitVerb(step.verb);
		const args = (interpolate(step.with ?? {}, scope) as Record<string, unknown>) ?? {};
		const request: PlaybookDispatch = { pluginId, verb, args };

		try {
			const result = await options.dispatch(request);
			const stepResult: PlaybookStepResult = { id, verb: step.verb, ok: true, result };
			if (step.saveAs) {
				bindings[step.saveAs] = result;
				scope[step.saveAs] = result; // thread it forward for later steps
				stepResult.savedAs = step.saveAs;
			}
			results.push(stepResult);
		} catch (error) {
			results.push({
				id,
				verb: step.verb,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
			if (!options.continueOnError) aborted = true;
		}
	}

	return {
		name: playbook.name,
		ok: results.every((r) => r.ok),
		steps: results,
		bindings,
	};
}
