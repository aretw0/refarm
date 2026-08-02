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
			command: typeof raw.command === "string" ? raw.command : `refarm ${raw.id}`,
			why: typeof raw.why === "string" ? raw.why : "",
		});
	}
	return operations;
}

export function readStartedRun(value: unknown): OperationRun | null {
	if (!isRecord(value) || value.started !== true) return null;
	if (typeof value.runId !== "string" || typeof value.operation !== "string") return null;
	return { runId: value.runId, operation: value.operation, state: "running", exitCode: null };
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
	return { runId: value.runId, operation: value.operation, state: value.state, exitCode };
}

export function operationRunPath(runId: string): string {
	return `${OPERATIONS_PATH}/${encodeURIComponent(runId)}`;
}

export function operationCancelPath(runId: string): string {
	return `${operationRunPath(runId)}/cancel`;
}
