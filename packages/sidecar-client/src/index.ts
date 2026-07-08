import { fetchWithTimeout, resolveRequestTimeoutMs } from "@refarm.dev/root";

const SIDECAR_REQUEST_TIMEOUT_ENV_VAR = "REFARM_SIDE_REQUEST_TIMEOUT_MS";
const DEFAULT_SIDE_REQUEST_TIMEOUT_MS = 500;

export interface GraphNode extends Record<string, unknown> {
	"@id": string;
	"@type": string;
}

export interface SidecarGraphClient {
	getNode(id: string): Promise<GraphNode | null>;
	queryNodes(type: string, options?: QueryGraphNodesOptions): Promise<GraphNode[]>;
}

export interface QueryGraphNodesOptions {
	limit?: number;
}

export interface SidecarGraphClientOptions {
	env?: NodeJS.ProcessEnv;
	timeoutEnvVar?: string;
	defaultTimeoutMs?: number;
	timeoutMs?: number;
	fetch?: typeof fetch;
}

function resolveSidecarRequestTimeoutMs(
	env: NodeJS.ProcessEnv = process.env,
	options: {
		timeoutEnvVar?: string;
		defaultTimeoutMs?: number;
		timeoutMs?: number;
	} = {},
): number {
	return resolveRequestTimeoutMs(env, {
		...options,
		timeoutEnvVar: options.timeoutEnvVar ?? SIDECAR_REQUEST_TIMEOUT_ENV_VAR,
		defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_SIDE_REQUEST_TIMEOUT_MS,
	});
}

export function createSidecarGraphClient(
	baseUrl: string | URL,
	options: SidecarGraphClientOptions = {},
): SidecarGraphClient {
	const base = normalizeSidecarBaseUrl(baseUrl);
	return {
		async getNode(id: string): Promise<GraphNode | null> {
			const response = await fetchSidecarWithTimeout(
				`${base}/nodes/${encodeURIComponent(id)}`,
				{},
				options,
			);
			if (response.status === 404) return null;
			if (!response.ok) throw new Error(`sidecar graph HTTP ${response.status}`);
			const body = asObject(await response.json());
			const node = asGraphNode(body?.node);
			if (!node) throw new Error("sidecar graph response missing node");
			return node;
		},
		async queryNodes(
			type: string,
			queryOptions: QueryGraphNodesOptions = {},
		): Promise<GraphNode[]> {
			const limit = queryOptions.limit ?? 100;
			const response = await fetchSidecarWithTimeout(
				`${base}/nodes?type=${encodeURIComponent(type)}&limit=${limit}`,
				{},
				options,
			);
			if (!response.ok) throw new Error(`sidecar graph HTTP ${response.status}`);
			const body = asObject(await response.json());
			const nodes = Array.isArray(body?.nodes) ? body.nodes : null;
			if (!nodes) throw new Error("sidecar graph response missing nodes");
			return nodes.map((node) => {
				const graphNode = asGraphNode(node);
				if (!graphNode) {
					throw new Error("sidecar graph response includes malformed node");
				}
				return graphNode;
			});
		},
	};
}

function normalizeSidecarBaseUrl(baseUrl: string | URL): string {
	return String(baseUrl).replace(/\/+$/, "");
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asGraphNode(value: unknown): GraphNode | null {
	const node = asObject(value);
	if (!node) return null;
	return typeof node["@id"] === "string" && typeof node["@type"] === "string"
		? (node as GraphNode)
		: null;
}

export { SIDECAR_REQUEST_TIMEOUT_ENV_VAR, resolveSidecarRequestTimeoutMs };

/**
 * `fetch` against a runtime HTTP sidecar with the sidecar's own timeout defaults
 * (env `REFARM_SIDE_REQUEST_TIMEOUT_MS`). A thin, domain-owned
 * wrapper over the generic {@link fetchWithTimeout} primitive — this is the ONE
 * client for talking to sidecars, consumed by CLIs, context providers, and
 * anything else that reaches that surface, so none of them reimplements the
 * call with a hardcoded port.
 */
export async function fetchSidecarWithTimeout(
	url: string | URL,
	init: RequestInit = {},
	options: {
		env?: NodeJS.ProcessEnv;
		timeoutEnvVar?: string;
		defaultTimeoutMs?: number;
		timeoutMs?: number;
		fetch?: typeof fetch;
	} = {},
): Promise<Response> {
	return fetchWithTimeout(url, init, {
		env: options.env,
		timeoutEnvVar: options.timeoutEnvVar ?? SIDECAR_REQUEST_TIMEOUT_ENV_VAR,
		defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_SIDE_REQUEST_TIMEOUT_MS,
		timeoutMs: options.timeoutMs,
		fetch: options.fetch,
	});
}
