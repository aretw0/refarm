import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import type { Effort } from "@refarm.dev/effort-contract-v1";

export interface RuntimeAgentRespondEffortOptions {
	prompt: string;
	system: string;
	sessionId: string;
	source: "refarm-ask" | "refarm-ask:worker" | "refarm-ask:monitor" | "refarm-chat";
	historyTurns: number;
	modelProvider?: string;
	modelId?: string;
	/**
	 * ADR-012 routing profile (cheap|balanced|reliable). When set, the guest resolves
	 * the route by profile against its configured providers. An explicit
	 * `modelProvider`/`modelId` override still takes precedence, so the caller passes a
	 * profile INSTEAD of a pinned route — not alongside one.
	 */
	profile?: string;
	/**
	 * A DECLARED scenario id, so two runs of the same work can be grouped even when the
	 * request differs — most concretely the same question put to two models, which the
	 * derived `scenario.hash` deliberately keeps apart because two models asked one
	 * question ARE two different requests.
	 *
	 * Absent when the operator declares none: `refarm ask` without `--scenario` sends no
	 * field, and the observation records no id rather than an invented one.
	 */
	scenarioId?: string;
	now?: () => Date;
	randomUUID?: () => string;
}

export function createRuntimeAgentRespondEffort({
	prompt,
	system,
	sessionId,
	source,
	historyTurns,
	modelProvider,
	modelId,
	profile,
	scenarioId,
	now = () => new Date(),
	randomUUID = () => crypto.randomUUID(),
}: RuntimeAgentRespondEffortOptions): Effort {
	const args: Record<string, unknown> = {
		prompt,
		system,
		session_id: sessionId,
		history_turns: historyTurns,
	};
	if (modelProvider) args.provider = modelProvider;
	if (modelId) args.model = modelId;
	if (profile) args.profile = profile;

	const declaredScenario = scenarioId?.trim();

	return {
		id: randomUUID(),
		direction: "ask",
		// Spread, not a key set to undefined: the wire field is `#[serde(default)]` and the
		// node must record no id at all rather than a null, which would be
		// indistinguishable from the "could not tell" a restart mid-run leaves behind.
		...(declaredScenario ? { scenarioId: declaredScenario } : {}),
		tasks: [
			{
				id: randomUUID(),
				pluginId: RUNTIME_AGENT_PLUGIN_ID,
				fn: "respond",
				args,
			},
		],
		source,
		submittedAt: now().toISOString(),
	};
}
