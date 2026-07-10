import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import type { PressureSnapshot, PressureWindow } from "@refarm.dev/pressure-contract-v1";
import { fetchWithTimeout, resolveRequestTimeoutMs } from "@refarm.dev/root";

const SIDECAR_REQUEST_TIMEOUT_ENV_VAR = "REFARM_SIDE_REQUEST_TIMEOUT_MS";
const DEFAULT_SIDE_REQUEST_TIMEOUT_MS = 500;

export type SidecarGraphNode = NormalisedNode;

export interface SidecarGraphClient {
	getNode(id: string): Promise<SidecarGraphNode | null>;
	queryNodes(type: string, options?: QueryGraphNodesOptions): Promise<SidecarGraphNode[]>;
}

export interface PressureClient {
	getSnapshot(): Promise<PressureSnapshot>;
	getWindow(minutes: number): Promise<PressureWindow | null>;
}

export interface QueryGraphNodesOptions {
	limit?: number;
}

export interface SidecarRequestOptions {
	env?: NodeJS.ProcessEnv;
	timeoutEnvVar?: string;
	defaultTimeoutMs?: number;
	timeoutMs?: number;
	fetch?: typeof fetch;
}

export interface SidecarJsonRequestOptions extends SidecarRequestOptions {
	errorLabel?: string;
}

export type SidecarGraphClientOptions = SidecarRequestOptions;
export type PressureClientOptions = SidecarRequestOptions;

export class SidecarHttpError extends Error {
	readonly status: number;
	readonly errorLabel: string;

	constructor(status: number, errorLabel = "sidecar HTTP") {
		super(`${errorLabel} ${status}`);
		this.name = "SidecarHttpError";
		this.status = status;
		this.errorLabel = errorLabel;
	}
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
		async getNode(id: string): Promise<SidecarGraphNode | null> {
			let body: unknown;
			try {
				body = await fetchSidecarJson(
					`${base}/nodes/${encodeURIComponent(id)}`,
					{},
					{ ...options, errorLabel: "sidecar graph HTTP" },
				);
			} catch (err) {
				if (err instanceof SidecarHttpError && err.status === 404) {
					return null;
				}
				throw err;
			}
			const bodyObject = asObject(body);
			const node = asSidecarGraphNode(bodyObject?.node);
			if (!node) throw new Error("sidecar graph response missing node");
			return node;
		},
		async queryNodes(
			type: string,
			queryOptions: QueryGraphNodesOptions = {},
		): Promise<SidecarGraphNode[]> {
			const limit = queryOptions.limit ?? 100;
			const body = asObject(
				await fetchSidecarJson(
					`${base}/nodes?type=${encodeURIComponent(type)}&limit=${limit}`,
					{},
					{ ...options, errorLabel: "sidecar graph HTTP" },
				),
			);
			const nodes = Array.isArray(body?.nodes) ? body.nodes : null;
			if (!nodes) throw new Error("sidecar graph response missing nodes");
			return nodes.map((node) => {
				const graphNode = asSidecarGraphNode(node);
				if (!graphNode) {
					throw new Error("sidecar graph response includes malformed node");
				}
				return graphNode;
			});
		},
	};
}

export function createPressureClient(
	baseUrl: string | URL,
	options: PressureClientOptions = {},
): PressureClient {
	const base = normalizeSidecarBaseUrl(baseUrl);
	return {
		async getSnapshot(): Promise<PressureSnapshot> {
			return fetchSidecarJson<PressureSnapshot>(
				`${base}/telemetry`,
				{},
				{ ...options, errorLabel: "pressure HTTP" },
			);
		},
		async getWindow(minutes: number): Promise<PressureWindow | null> {
			try {
				return await fetchSidecarJson<PressureWindow>(
					`${base}/telemetry/window?minutes=${minutes}`,
					{},
					{ ...options, errorLabel: "pressure window HTTP" },
				);
			} catch (err) {
				if (err instanceof SidecarHttpError && err.status === 404) {
					return null;
				}
				throw err;
			}
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

function asSidecarGraphNode(value: unknown): SidecarGraphNode | null {
	const node = asObject(value);
	if (!node) return null;
	const context = node["@context"];
	const hasContext =
		typeof context === "string" ||
		(context !== null && typeof context === "object" && !Array.isArray(context));
	return hasContext && typeof node["@id"] === "string" && typeof node["@type"] === "string"
		? (node as SidecarGraphNode)
		: null;
}

export { SIDECAR_REQUEST_TIMEOUT_ENV_VAR, resolveSidecarRequestTimeoutMs };

/**
 * `fetch` against a host HTTP sidecar with the sidecar's own timeout defaults
 * (env `REFARM_SIDE_REQUEST_TIMEOUT_MS`). A thin, domain-owned
 * wrapper over the generic {@link fetchWithTimeout} primitive — this is the ONE
 * client for talking to sidecars, consumed by CLIs, context providers, and
 * anything else that reaches that surface, so none of them reimplements the
 * call with a hardcoded port.
 */
export async function fetchSidecarWithTimeout(
	url: string | URL,
	init: RequestInit = {},
	options: SidecarRequestOptions = {},
): Promise<Response> {
	return fetchWithTimeout(url, init, {
		env: options.env,
		timeoutEnvVar: options.timeoutEnvVar ?? SIDECAR_REQUEST_TIMEOUT_ENV_VAR,
		defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_SIDE_REQUEST_TIMEOUT_MS,
		timeoutMs: options.timeoutMs,
		fetch: options.fetch,
	});
}

export async function fetchSidecarJson<T = unknown>(
	url: string | URL,
	init: RequestInit = {},
	options: SidecarJsonRequestOptions = {},
): Promise<T> {
	const response = await fetchSidecarWithTimeout(url, init, options);
	if (!response.ok) {
		throw new SidecarHttpError(response.status, options.errorLabel);
	}
	return (await response.json()) as T;
}
