import type { CapabilityDescriptor } from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";

import {
	buildDispatchEffort,
	parseDispatchArgs,
	type SubmitEffort,
} from "@refarm.dev/capability-host";
import { submitEffortViaSidecar } from "./dispatch-submit.js";

/**
 * `refarm dispatch <plugin> <verb> [key=value...]` — the ONE operator command to
 * dispatch a verb to ANY loaded plugin, the CLI mirror of the generic e2e harness
 * (one path for every plugin, not one command per plugin). It submits an effort to
 * the runtime; the sidecar routes the non-`respond` fn to the target plugin via
 * the neutral event router, and the async result lands as a dispatch-result:v1
 * node keyed by the returned effort id.
 *
 * Args are `key=value` pairs, each value parsed as JSON when it parses (so
 * `note={"path":"x"}` and `limit=5` become structured), else kept as a string.
 * Deps (submit, id, clock) are injected so run() is testable without a daemon.
 */
export interface DispatchCommandDeps {
	submitEffort: SubmitEffort;
	newId: () => string;
	nowIso: () => string;
}

export function defaultDispatchDeps(): DispatchCommandDeps {
	return {
		submitEffort: submitEffortViaSidecar,
		newId: () => crypto.randomUUID(),
		nowIso: () => new Date().toISOString(),
	};
}

// `parseDispatchArgs` is exposed through the host-facing plugin bridge;
// re-exported here so existing app consumers import it from this module unchanged.
export { parseDispatchArgs };

export function createDispatchCapability(
	deps: DispatchCommandDeps = defaultDispatchDeps(),
): CapabilityDescriptor {
	return {
		name: "dispatch",
		summary: "Dispatch a verb to any loaded plugin via the runtime",
		args: [
			{ name: "plugin", required: true },
			{ name: "verb", required: true },
			{ name: "args", variadic: true },
		],
		async run(input) {
			const pluginId = input.args.plugin as string;
			const verb = input.args.verb as string;
			const rawArgs = (input.args.args as string[] | undefined) ?? [];

			const parsed = parseDispatchArgs(rawArgs);
			if ("error" in parsed) {
				return buildJsonErrorEnvelope({
					command: "dispatch",
					operation: "dispatch",
					error: "invalid-args",
					message: parsed.error,
					nextAction: 'Pass args as key=value, e.g. `dispatch vault extract note={"path":"n.md"}`.',
				});
			}

			const effort = buildDispatchEffort(
				{ pluginId, verb, args: parsed.args },
				deps.newId,
				deps.nowIso,
			);

			try {
				const effortId = await deps.submitEffort(effort);
				return buildJsonSuccessEnvelope({
					command: "dispatch",
					operation: "dispatch",
					extra: {
						effortId,
						pluginId,
						verb,
						replyRef: effort.id,
					},
					nextAction: `The result will be stored as a dispatch-result node keyed by replyRef "${effort.id}".`,
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "dispatch",
					operation: "dispatch",
					error: "dispatch-failed",
					message: `Could not submit the dispatch: ${String(error)}`,
					nextAction:
						"Is the runtime daemon up? Run `refarm runtime status`. Is the plugin loaded and does its manifest declare subscribes:[<plugin>:dispatch]?",
				});
			}
		},
		transports: {
			cli: {},
			repl: {},
			http: { method: "POST", path: "/dispatch" },
		},
	};
}
