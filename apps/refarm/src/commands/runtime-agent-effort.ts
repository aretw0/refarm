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
	/**
	 * What the answer must contain for this run to count as RIGHT — the caller's
	 * declared expectation (`refarm ask --expect <text>`).
	 *
	 * A separate fact from the effort's terminal status, which is all
	 * `refarm.outcome` ever said: on 2026-08-05 an agent answered 58 where the
	 * answer was 59 and the record said `done`, correctly, with nothing beside it.
	 * The node now carries a verdict too, judged by substring match — see the
	 * sidecar's `verification` module for the three states and what that matcher
	 * cannot grade.
	 *
	 * Absent when the operator declares none, exactly like `scenarioId` above:
	 * `refarm ask` without `--expect` sends no field, and the observation records
	 * no verdict rather than a null that would read as "checked and inconclusive".
	 */
	expectation?: string;
	/**
	 * WHICH WORKSPACE this run belongs to — the axis that separates one project's cost
	 * from another's, measured blank on 16 of 16 `refarm ask` runs before this existed.
	 *
	 * Travels TWICE, to two consumers, from one resolved value: at the Effort root for
	 * the sidecar, which writes `refarm.workspace.id` onto the BudgetObservation, and in
	 * `args` for the agent, which stamps it on the Session node so later runs in the same
	 * session inherit it instead of re-deriving.
	 *
	 * Absent when nobody declared one, exactly like `scenarioId` and `expectation`.
	 */
	workspaceId?: string;
	/**
	 * HOW the workspace above was arrived at: `declared` when a human typed
	 * `--workspace`, `seeded-from-cwd` when it was inferred at session creation from the
	 * directory the operator stood in.
	 *
	 * Not decoration. `workspaceId` selects budget folds and, later, per-workspace policy,
	 * and ADR-094's H2 permits cwd as authoring convenience but not as policy truth. A
	 * seed that could not be told apart from a declaration would honour that rule in form
	 * while breaking it in substance.
	 */
	workspaceSource?: "declared" | "seeded-from-cwd";
	/**
	 * WHICH ACCOUNT'S QUOTA THIS DISPATCH SPENDS — the opaque credential id the caller's
	 * workspace binding resolved to, never an alias.
	 *
	 * DECLARED here rather than derived downstream, for the reason `workspaceSource` exists two
	 * fields up: only the caller knows which binding applied, and by the time the observation
	 * reads it a re-derivation could disagree with what actually paid. The record has read
	 * `refarm.budget.credentialId` since d1b94ec5 and nothing wrote it — 32 observations on the
	 * operator's node, all unattributed (ISS-130).
	 *
	 * It is load-bearing rather than bookkeeping: ISS-129 measured that GitHub Copilot answers
	 * the quota question with a null counter for both of his SKUs, so the only sovereign
	 * depletion signal left is the dispatch outcome — and an outcome nobody can attribute to an
	 * account cannot say which account ran out.
	 */
	credentialId?: string;
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
	expectation,
	workspaceId,
	workspaceSource,
	credentialId,
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
	const declaredExpectation = expectation?.trim();
	const declaredWorkspace = workspaceId?.trim();
	const declaredCredential = credentialId?.trim();

	if (declaredWorkspace) {
		args.workspace_id = declaredWorkspace;
		if (workspaceSource) args.workspace_source = workspaceSource;
	}

	return {
		id: randomUUID(),
		direction: "ask",
		// Spread, not a key set to undefined: the wire field is `#[serde(default)]` and the
		// node must record no id at all rather than a null, which would be
		// indistinguishable from the "could not tell" a restart mid-run leaves behind.
		...(declaredScenario ? { scenarioId: declaredScenario } : {}),
		// Same spread rule, same reason: `credential_id` is `#[serde(default)]` on the host and an
		// unattributed dispatch must record NO key. A null payer is indistinguishable, once
		// aggregated, from a dispatch that spent nobody's quota, and `budget by-account` already
		// counts an absent field as `unattributed` — which is the true answer.
		...(declaredCredential ? { credentialId: declaredCredential } : {}),
		// Same rule, same reason, for the expectation: absent when nobody declared one,
		// so the observation carries no verdict key at all. An empty `--expect ""` is no
		// declaration either — it is a substring of every answer, so it would record a
		// meaningless `passed: true` on every run that answered anything.
		...(declaredExpectation ? { expectation: declaredExpectation } : {}),
		// Same spread-or-nothing rule as the two above. The root field is what the sidecar
		// reads onto the observation; `args.workspace_id` above is what the agent reads onto
		// the Session node. One value, two readers, no null between them.
		...(declaredWorkspace ? { workspaceId: declaredWorkspace } : {}),
		// The PROVENANCE rides with the id, on the root as well as in `args`. Sending the id
		// alone made a seed and a declaration the same string by the time the sidecar read it,
		// so a directory that looked like a workspace selected that workspace's spending
		// ceiling exactly as the operator naming it would (ISS-058). Both or neither — the id
		// is what gates this spread, so a source can never arrive without one.
		...(declaredWorkspace && workspaceSource ? { workspaceSource } : {}),
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
