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

/** The three axes a spawner may declare, matching the wire's camelCase shape
 *  (`Effort.budget` — see @refarm.dev/budget-contract-v1's `BudgetDeclaration`,
 *  the same shape `refarm dispatch --budget-*` sends). Every field optional. */
const BUDGET_FIELDS = ["deadlineMs", "maxTokens", "maxUsd"];

/**
 * Validate + normalize a declared budget — the ONE place in this kit that checks
 * the three axes, so `buildRespondEffort` below and any other effort-building
 * surface (e.g. `bin/farm-ask.mjs`'s env-var reading) call this instead of each
 * hand-rolling its own numeric check. This package has no TypeScript compiler to
 * catch a typo in a second copy (see eslint.config.mjs's `no-undef` note) — one
 * function is the only way to guarantee the two surfaces never drift.
 *
 * Absent (`undefined`) stays absent — no key at all, never `0`, never `null`.
 * A present value (`number` or a numeric `string`, so it accepts both a direct
 * caller and a raw `process.env` read) must be finite and non-negative; **zero
 * is accepted** as a real declared ceiling (the node's own resolution treats a
 * present zero as a genuine ceiling, never as "nothing declared" — rejecting it
 * here would make the kit lie about what the node can express). Anything else
 * throws, naming the field, before any effort is built or dispatched.
 *
 * Returns `undefined` when no axis is declared, so a caller can skip attaching
 * `budget` entirely and the wire stays byte-identical to declaring nothing.
 */
export function parseBudgetDeclaration({ deadlineMs, maxTokens, maxUsd } = {}) {
	const raw = { deadlineMs, maxTokens, maxUsd };
	const budget = {};
	for (const field of BUDGET_FIELDS) {
		const value = raw[field];
		if (value === undefined) continue;
		const trimmed = typeof value === "string" ? value.trim() : value;
		if (trimmed === "") {
			throw new Error(`budget.${field} must be a number, got an empty string`);
		}
		const n = typeof trimmed === "number" ? trimmed : Number(trimmed);
		if (!Number.isFinite(n)) {
			throw new Error(`budget.${field} must be a number, got ${JSON.stringify(value)}`);
		}
		if (n < 0) {
			throw new Error(`budget.${field} must not be negative, got ${JSON.stringify(value)}`);
		}
		budget[field] = n;
	}
	return Object.keys(budget).length > 0 ? budget : undefined;
}

/** Build the Effort envelope. `randomUUID`/`now` are injectable for tests.
 *  `deadlineMs`/`maxTokens`/`maxUsd` declare this dispatch's own budget (optional,
 *  validated by `parseBudgetDeclaration`) — omit all three to leave `budget`
 *  off the wire entirely, unchanged from before this option existed. */
export function buildRespondEffort(
	prompt,
	{
		historyTurns = 0,
		provider,
		model,
		source = "farm-ask",
		deadlineMs,
		maxTokens,
		maxUsd,
		randomUUID = () => crypto.randomUUID(),
		now = () => new Date(),
	} = {},
) {
	const args = { prompt, history_turns: historyTurns };
	// Only carry a route when explicitly chosen — absent means the farm's default.
	if (provider) args.provider = provider;
	if (model) args.model = model;

	const budget = parseBudgetDeclaration({ deadlineMs, maxTokens, maxUsd });

	const effort = {
		id: randomUUID(),
		direction: "ask",
		tasks: [{ id: randomUUID(), pluginId: AGENT_PLUGIN_ID, fn: "respond", args }],
		source,
		submittedAt: now().toISOString(),
	};
	// Only carry a budget when the caller declared at least one axis — a spawner
	// that declares nothing must be byte-identical on the wire to today's effort.
	if (budget) effort.budget = budget;
	return effort;
}
