/**
 * effort — build an agent-respond effort for the farm's sidecar.
 *
 * Workload-neutral in spirit (an effort is any workload), but this helper builds
 * the common one: delegate a prompt to the runtime agent's `respond` verb. The
 * route is OPTIONAL — omit provider/model to use the farm's DEFAULT route; pass
 * them to target a specific model (e.g. a worker-quota model like
 * openai-codex/gpt-5.3-codex-spark) so a caller can offload to a cheaper/
 * separate-quota worker without touching the farm's config.
 */

const AGENT_PLUGIN_ID = "@refarm/agent";

/** Build the Effort envelope. `randomUUID`/`now` are injectable for tests. */
export function buildRespondEffort(
	prompt,
	{
		historyTurns = 0,
		provider,
		model,
		source = "farm-ask",
		randomUUID = () => crypto.randomUUID(),
		now = () => new Date(),
	} = {},
) {
	const args = { prompt, history_turns: historyTurns };
	// Only carry a route when explicitly chosen — absent means the farm's default.
	if (provider) args.provider = provider;
	if (model) args.model = model;

	return {
		id: randomUUID(),
		direction: "ask",
		tasks: [{ id: randomUUID(), pluginId: AGENT_PLUGIN_ID, fn: "respond", args }],
		source,
		submittedAt: now().toISOString(),
	};
}
