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

/** Pull the agent's text answer from an EffortResult, tolerant of shape. */
export function extractAnswer(effortResult) {
	const task = (effortResult?.results ?? []).find((t) => t?.status === "ok") ?? effortResult?.results?.[0];
	if (!task) return null;
	if (task.error) return `⚠️ ${task.error}`;
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
