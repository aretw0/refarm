import {
	OPERATIONS_PATH,
	operationRunPath,
	readOperationCatalog,
	readOperationRun,
	readStartedRun,
	type AdmittedOperation,
	type OperationRun,
} from "./wire.js";

export type OperationRefusalKind =
	| "unauthorized"
	| "already-running"
	| "unknown-operation"
	| "not-remotely-invocable"
	| "unknown-run"
	| "unavailable"
	| "invalid-response";

export interface OperationRefusal {
	readonly kind: OperationRefusalKind;
	readonly status: number | null;
	readonly detail: string;
}

export type OperationCatalogOutcome =
	| { readonly ok: true; readonly operations: readonly AdmittedOperation[] }
	| { readonly ok: false; readonly refusal: OperationRefusal };

export type OperationRunOutcome =
	| { readonly ok: true; readonly run: OperationRun }
	| { readonly ok: false; readonly refusal: OperationRefusal };

export type OperationFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface OperationClient {
	list(signal?: AbortSignal): Promise<OperationCatalogOutcome>;
	start(operation: string, signal?: AbortSignal): Promise<OperationRunOutcome>;
	status(runId: string, signal?: AbortSignal): Promise<OperationRunOutcome>;
}

function detailOf(body: unknown): string {
	return typeof body === "object" &&
		body !== null &&
		typeof (body as { detail?: unknown }).detail === "string"
		? (body as { detail: string }).detail
		: "";
}

function errorOf(body: unknown): string {
	return typeof body === "object" &&
		body !== null &&
		typeof (body as { error?: unknown }).error === "string"
		? (body as { error: string }).error
		: "";
}

async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

function refusal(status: number, body: unknown): OperationRefusal {
	const error = errorOf(body);
	let kind: OperationRefusalKind = "invalid-response";
	if (status === 401 || status === 403)
		kind = error === "not-remotely-invocable" ? error : "unauthorized";
	else if (status === 409) kind = "already-running";
	else if (status === 404) kind = error === "unknown-run" ? "unknown-run" : "unknown-operation";
	else if (status === 502 || status === 503) kind = "unavailable";
	return { kind, status, detail: detailOf(body) };
}

function unreachable(error: unknown): OperationRefusal {
	return {
		kind: "unavailable",
		status: null,
		detail: error instanceof Error ? error.message : String(error),
	};
}

export function createOperationClient(options: {
	readonly baseUrl?: string;
	readonly fetch?: OperationFetch;
	readonly token: () => string | null;
}): OperationClient {
	const base = options.baseUrl ?? "";
	const doFetch =
		options.fetch ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
	const headers = (): Record<string, string> => {
		const token = options.token();
		return token ? { authorization: `Bearer ${token}` } : {};
	};
	return {
		async list(signal) {
			try {
				const response = await doFetch(`${base}${OPERATIONS_PATH}`, {
					headers: { accept: "application/json", ...headers() },
					...(signal ? { signal } : {}),
				});
				const body = await readJson(response);
				if (!response.ok) return { ok: false, refusal: refusal(response.status, body) };
				const operations = readOperationCatalog(body);
				return operations
					? { ok: true, operations }
					: { ok: false, refusal: refusal(response.status, body) };
			} catch (error) {
				return { ok: false, refusal: unreachable(error) };
			}
		},
		async start(operation, signal) {
			try {
				const response = await doFetch(`${base}${OPERATIONS_PATH}`, {
					method: "POST",
					headers: { accept: "application/json", "content-type": "application/json", ...headers() },
					body: JSON.stringify({ operation }),
					...(signal ? { signal } : {}),
				});
				const body = await readJson(response);
				if (!response.ok) return { ok: false, refusal: refusal(response.status, body) };
				const run = readStartedRun(body);
				return run ? { ok: true, run } : { ok: false, refusal: refusal(response.status, body) };
			} catch (error) {
				return { ok: false, refusal: unreachable(error) };
			}
		},
		async status(runId, signal) {
			try {
				const response = await doFetch(`${base}${operationRunPath(runId)}`, {
					headers: { accept: "application/json", ...headers() },
					...(signal ? { signal } : {}),
				});
				const body = await readJson(response);
				if (!response.ok) return { ok: false, refusal: refusal(response.status, body) };
				const run = readOperationRun(body);
				return run ? { ok: true, run } : { ok: false, refusal: refusal(response.status, body) };
			} catch (error) {
				return { ok: false, refusal: unreachable(error) };
			}
		},
	};
}
