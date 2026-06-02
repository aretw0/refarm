import type { EffortResult } from "@refarm.dev/effort-contract-v1";

const AGENT_ERROR_PREFIXES = ["[pi-agent erro]", "[pi-agent stub]", "[budget]"];

function parseTaskResultPayload(result: unknown): unknown {
	if (typeof result !== "string") return result;
	try {
		return JSON.parse(result) as unknown;
	} catch {
		return result;
	}
}

function taskResultContent(result: unknown): string | null {
	const payload = parseTaskResultPayload(result);
	if (typeof payload === "string") return payload;
	if (Array.isArray(payload)) {
		const [content] = payload;
		return typeof content === "string" ? content : null;
	}
	if (payload && typeof payload === "object") {
		const content = (payload as { content?: unknown }).content;
		return typeof content === "string" ? content : null;
	}
	return null;
}

export function observedTaskResultError(result: unknown): string | null {
	const content = taskResultContent(result);
	if (!content) return null;
	return AGENT_ERROR_PREFIXES.some((prefix) => content.startsWith(prefix))
		? content
		: null;
}

export function observedTaskResultStatus(
	taskResult: EffortResult["results"][number],
): string {
	if (taskResult.status !== "ok") return taskResult.status;
	return observedTaskResultError(taskResult.result) ? "error" : taskResult.status;
}

export function observedEffortStatus(
	result: EffortResult,
): EffortResult["status"] {
	if (result.status !== "done") return result.status;
	return result.results.some(
		(taskResult) => observedTaskResultStatus(taskResult) === "error",
	)
		? "failed"
		: result.status;
}
