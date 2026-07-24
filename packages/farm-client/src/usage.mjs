/**
 * usage — read and present a workload turn's token/cost accounting.
 *
 * The runtime already METERS every turn: the `respond` result carries a `usage`
 * block (tokens_in/out/reasoning, cached, estimated_usd, pricing_mode). That is
 * the "good control underneath". This module is the surface-agnostic BLOCK that
 * turns that raw block into something a device can SHOW — a pocket CLI today, a
 * TUI or a web input-box badge tomorrow. Every function here is pure (no I/O, no
 * deps), so the same primitive extends to every surface.
 *
 * Two halves:
 *   parseUsage(effortResult) → a normalized {tokensIn,...} object (or null)
 *   formatUsage(usage)       → a one-line footer, emphasizing pre-prompt context
 */

/** Select the same task extractAnswer shows, so usage lines up with the answer. */
function resultOf(effortResult) {
	const results = effortResult?.results ?? [];
	const task = results.find((t) => t?.status === "ok") ?? results[0];
	return task?.result ?? null;
}

/** The `respond` result is an object, but tolerate a JSON string too. */
function asObject(result) {
	if (result == null) return null;
	if (typeof result === "object") return result;
	if (typeof result === "string") {
		try {
			return JSON.parse(result);
		} catch {
			return null;
		}
	}
	return null;
}

function num(value) {
	return Number.isFinite(value) ? value : 0;
}

/**
 * Pull the usage block out of an EffortResult and normalize it. Returns null
 * when the turn carried no metering (older runtimes, or a non-agent workload) —
 * a surface should then simply show nothing, never a row of zeros.
 */
export function parseUsage(effortResult) {
	const obj = asObject(resultOf(effortResult));
	const usage = obj?.usage;
	if (!usage || typeof usage !== "object") return null;
	// cached tokens live only in the raw provider usage (Responses vs Chat shape).
	const cached = num(
		usage.raw?.input_tokens_details?.cached_tokens ??
			usage.raw?.prompt_tokens_details?.cached_tokens ??
			usage.tokens_cached,
	);
	return {
		tokensIn: num(usage.tokens_in),
		tokensOut: num(usage.tokens_out),
		tokensReasoning: num(usage.tokens_reasoning),
		tokensCached: cached,
		estimatedUsd: Number.isFinite(usage.estimated_usd) ? usage.estimated_usd : null,
		pricingMode: typeof usage.pricing_mode === "string" ? usage.pricing_mode : null,
		model: typeof obj.model === "string" ? obj.model : null,
		provider: typeof obj.provider === "string" ? obj.provider : null,
	};
}

/** Compact a token count for a dense footer: 1234 → "1.2k", 980 → "980". */
export function compactTokens(value) {
	const v = num(Number(value));
	if (v < 1000) return String(v);
	if (v < 10000) return `${(v / 1000).toFixed(1)}k`;
	return `${Math.round(v / 1000)}k`;
}

/** Estimated cost. null/unknown → "" ; tiny → 4 decimals ; else 2 decimals. */
export function formatUsd(usd) {
	if (usd == null || !Number.isFinite(usd)) return "";
	if (usd === 0) return "~$0";
	if (usd < 0.01) return `~$${usd.toFixed(4)}`;
	return `~$${usd.toFixed(2)}`;
}

/**
 * One-line, surface-agnostic usage footer. tokensIn comes first on purpose: it
 * is the pre-prompt context size, so "how heavy was this turn" is felt at a
 * glance — the antidote to silent context bloat. A richer surface (TUI, web)
 * can ignore this string and render the parsed object however it likes.
 */
export function formatUsage(usage, opts = {}) {
	if (!usage) return "";
	const parts = [`${compactTokens(usage.tokensIn)} in`, `${compactTokens(usage.tokensOut)} out`];
	if (usage.tokensReasoning > 0) parts.push(`${compactTokens(usage.tokensReasoning)} reasoning`);
	if (usage.tokensCached > 0) parts.push(`${compactTokens(usage.tokensCached)} cached`);
	// A subscription/quota turn has no marginal dollar cost (estimated_usd == 0):
	// the tokens above ARE the spend, so show the mode tag, not a misleading "$0".
	// A metered turn (estimated_usd > 0) shows the dollar figure with its mode.
	const usd = formatUsd(usage.estimatedUsd);
	if (usage.estimatedUsd > 0 && usd) {
		parts.push(usage.pricingMode ? `${usd} ${usage.pricingMode}` : usd);
	} else if (usage.pricingMode) {
		parts.push(usage.pricingMode);
	}
	return `${opts.prefix ?? "↳"} ${parts.join(" · ")}`;
}
