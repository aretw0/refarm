/**
 * effort-result — read an agent's answer out of an EffortResult.
 *
 * Pure helpers shared by the zero-dependency device clients (farm-ask). The
 * sidecar's GET /efforts/:id returns an EffortResult; the agent's `respond`
 * task carries its text at results[0].result.content, but be tolerant — a
 * plain string, {text}, or {message} are all accepted, JSON as last resort.
 */

const TERMINAL = new Set(["done", "delivered", "partial", "failed", "timed-out", "cancelled"]);

/** Has the effort stopped running? (anything but pending/in-progress) */
export function isTerminalEffort(status) {
	return typeof status === "string" && TERMINAL.has(status);
}

/** Did it end well enough to have an answer? */
export function isSuccessEffort(status) {
	return status === "done" || status === "delivered" || status === "partial";
}

/**
 * Turn a raw agent error into an actionable hint, then let the surface show it.
 * Generic on purpose — pattern-based, not a per-model table — so a model gated by
 * the account's plan (e.g. a Pro-only model on a Plus plan) points at the next
 * step instead of leaking a raw backend string. The model id is lifted from the
 * message itself, and the original detail is preserved (never hidden).
 */
export function humanizeAgentError(text) {
	const raw = typeof text === "string" ? text : String(text ?? "");
	const lower = raw.toLowerCase();
	const planGated =
		lower.includes("not supported when using") ||
		(lower.includes("not supported") && lower.includes("model")) ||
		lower.includes("does not have access");
	if (planGated) {
		const model = raw.match(/'([^']+)'/)?.[1];
		return (
			`⚠️ O modelo ${model ? `'${model}' ` : ""}não está disponível no seu plano — ` +
			`verifique seu plano ou use outro modelo disponível (ex.: gpt-5.5).\n   detalhe: ${raw}`
		);
	}
	return `⚠️ ${raw}`;
}

/** Pull the agent's text answer from an EffortResult, tolerant of shape. */
export function extractAnswer(effortResult) {
	const task = (effortResult?.results ?? []).find((t) => t?.status === "ok") ?? effortResult?.results?.[0];
	if (!task) return null;
	if (task.error) return humanizeAgentError(task.error);
	return textFromResult(task.result);
}

function textFromResult(result) {
	if (result == null) return null;
	if (typeof result === "string") return result;
	if (typeof result.content === "string") return result.content;
	if (typeof result.text === "string") return result.text;
	if (typeof result.message === "string") return result.message;
	try {
		return JSON.stringify(result);
	} catch {
		return String(result);
	}
}
