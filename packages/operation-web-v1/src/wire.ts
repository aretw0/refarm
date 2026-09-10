export const OPERATIONS_PATH = "/operations";
export const REMOTE_INITIATION_WIRE = "remote-initiation.v1";

export interface AdmittedOperation {
	readonly id: string;
	readonly command: string;
	readonly why: string;
}

export interface OperationRun {
	readonly runId: string;
	readonly operation: string;
	readonly state: "running" | "succeeded" | "failed" | "cancelled";
	readonly exitCode: number | null;
	readonly result: OperationResult | null;
	readonly resultError: string | null;
}

export interface OperationResult {
	readonly wire: "operation-result.v1";
	readonly status: "succeeded" | "issues" | "failed";
	readonly summary: string;
	readonly metrics: readonly { readonly name: string; readonly value: number; readonly unit?: string }[];
	readonly findings: readonly { readonly code: string; readonly summary: string; readonly location?: string }[];
	readonly truncated: boolean;
	readonly redactionCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readOperationCatalog(value: unknown): readonly AdmittedOperation[] | null {
	if (!isRecord(value) || !isRecord(value.catalog) || !Array.isArray(value.catalog.operations)) {
		return null;
	}
	const operations: AdmittedOperation[] = [];
	for (const raw of value.catalog.operations) {
		if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") continue;
		operations.push({
			id: raw.id,
			// The ID ALONE when the wire carried no command — not an invented `<brand> <id>`. The
			// old fallback guessed a command line and presented the guess as the operation's
			// command, which is both a brand literal in a generic package (ADR-087, ISS-114) and a
			// claim this module cannot support: it does not know how the node spells its verbs.
			command: typeof raw.command === "string" ? raw.command : raw.id,
			why: typeof raw.why === "string" ? raw.why : "",
		});
	}
	return operations;
}

export function readStartedRun(value: unknown): OperationRun | null {
	if (!isRecord(value) || value.started !== true) return null;
	if (typeof value.runId !== "string" || typeof value.operation !== "string") return null;
	return { runId: value.runId, operation: value.operation, state: "running", exitCode: null, result: null, resultError: null };
}

export function readOperationResult(value: unknown): OperationResult | null {
	if (!isRecord(value)) return null;
	if (Object.keys(value).sort().join("|") !== "findings|metrics|redactionCount|status|summary|truncated|wire") return null;
	if (value.wire !== "operation-result.v1" || !["succeeded", "issues", "failed"].includes(String(value.status))) return null;
	if (typeof value.summary !== "string" || value.summary.length > 512) return null;
	if (!Array.isArray(value.metrics) || value.metrics.length > 32) return null;
	if (!Array.isArray(value.findings) || value.findings.length > 50) return null;
	if (typeof value.truncated !== "boolean" || !Number.isInteger(value.redactionCount)) return null;
	if (value.metrics.some((metric) => !isRecord(metric) || typeof metric.name !== "string" || typeof metric.value !== "number" || !Number.isFinite(metric.value))) return null;
	if (value.findings.some((finding) => !isRecord(finding) || typeof finding.code !== "string" || typeof finding.summary !== "string")) return null;
	return value as unknown as OperationResult;
}

export function readOperationRun(value: unknown): OperationRun | null {
	if (!isRecord(value)) return null;
	if (typeof value.runId !== "string" || typeof value.operation !== "string") return null;
	if (
		value.state !== "running" &&
		value.state !== "succeeded" &&
		value.state !== "failed" &&
		value.state !== "cancelled"
	) {
		return null;
	}
	const exitCode =
		typeof value.exitCode === "number" && Number.isInteger(value.exitCode) ? value.exitCode : null;
	return {
		runId: value.runId,
		operation: value.operation,
		state: value.state,
		exitCode,
		result: readOperationResult(value.result),
		resultError: typeof value.resultError === "string" ? value.resultError : null,
	};
}

export function operationRunPath(runId: string): string {
	return `${OPERATIONS_PATH}/${encodeURIComponent(runId)}`;
}

export function operationCancelPath(runId: string): string {
	return `${operationRunPath(runId)}/cancel`;
}
