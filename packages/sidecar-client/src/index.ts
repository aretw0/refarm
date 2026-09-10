import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import type { PressureSnapshot, PressureWindow } from "@refarm.dev/pressure-contract-v1";
import { fetchWithTimeout, resolveRequestTimeoutMs } from "@refarm.dev/root";
import {
	type QueryNodesOptions,
	type QueryNodesPage,
	type ReadCompleteness,
	readCompleteness,
} from "@refarm.dev/storage-contract-v1";

const SIDECAR_REQUEST_TIMEOUT_ENV_VAR = "REFARM_SIDE_REQUEST_TIMEOUT_MS";
const DEFAULT_SIDE_REQUEST_TIMEOUT_MS = 500;

export type SidecarGraphNode = NormalisedNode;

export interface SidecarGraphClient {
	getNode(id: string): Promise<SidecarGraphNode | null>;
	queryNodes(type: string, options?: QueryGraphNodesOptions): Promise<QueryGraphNodesResult>;
}

export interface PressureClient {
	getSnapshot(): Promise<PressureSnapshot>;
	getWindow(minutes: number): Promise<PressureWindow | null>;
}

/** The contract's options, under this client's historical name. An ALIAS rather than an empty
 *  `extends`: an interface that adds nothing is a second declaration pretending to be a first,
 *  which is the drift this whole change removes. Kept as a name because callers import it. */
export type QueryGraphNodesOptions = QueryNodesOptions;

/**
 * `GET /nodes?type=…`'s page-level facts, alongside the rows themselves —
 * see docs/SOVEREIGN_RECORD_ORDERING.md ("What a response means now").
 *
 * THREE STATES, not two: `stored`/`truncated` are `undefined` TOGETHER when
 * the sidecar's response omitted them — a live case, not a hypothetical one.
 * Any node running a build from before these fields shipped omits both keys
 * from `GET /nodes`'s JSON body today, and a caller talking to that node has
 * no basis to say the page is complete. A caller MUST NOT default `truncated`
 * to `false` or derive `stored` from `nodes.length` in that gap — that is
 * exactly the silent-false-clean shape `apps/refarm/src/commands/budget.ts`
 * briefly reintroduced one layer up and was fixed for. Absent means absent;
 * it must propagate as `undefined`, never rounded to a boolean or a count.
 *
 * IT EXTENDS `QueryNodesPage` (`@refarm.dev/storage-contract-v1`) rather than restating it. The
 * rule was written here first and lived here alone; the same shape now sits on the contract that
 * fifteen storage adapters implement, and TWO DECLARATIONS THAT AGREE TODAY ARE TWO DECLARATIONS
 * THAT CAN DRIFT TOMORROW. Extending turns that drift into a compile error instead of a
 * discovery. `nodes` narrows to `SidecarGraphNode[]` — the sidecar knows what its own rows are.
 */
export interface QueryGraphNodesResult extends QueryNodesPage {
	nodes: SidecarGraphNode[];
	/** How many nodes of this `@type` exist right now — the true count, not this
	 *  page's size. `undefined` when the sidecar did not say (see the interface
	 *  doc) — NOT defaulted to `nodes.length`. */
	stored?: number;
	/** Whether this page left rows out. `true`/`false` only when the sidecar's
	 *  response said so; `undefined` when it didn't. The database is the only
	 *  side that can see what was NOT returned, so this is never computed here
	 *  from `stored` and the page size — an absent `stored` does not imply
	 *  `truncated: false`. */
	truncated?: boolean;
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
		): Promise<QueryGraphNodesResult> {
			const limit = queryOptions.limit ?? 100;
			// `offset` is omitted from the URL when zero rather than sent as `&offset=0`: an older
			// sidecar ignores the parameter either way, and a request that carries only what it
			// means is one less thing to explain when a response comes back short.
			const offset = queryOptions.offset ?? 0;
			const paging = offset > 0 ? `&offset=${offset}` : "";
			const body = asObject(
				await fetchSidecarJson(
					`${base}/nodes?type=${encodeURIComponent(type)}&limit=${limit}${paging}`,
					{},
					{ ...options, errorLabel: "sidecar graph HTTP" },
				),
			);
			const rawNodes = Array.isArray(body?.nodes) ? body.nodes : null;
			if (!rawNodes) throw new Error("sidecar graph response missing nodes");
			const nodes = rawNodes.map((node) => {
				const graphNode = asSidecarGraphNode(node);
				if (!graphNode) {
					throw new Error("sidecar graph response includes malformed node");
				}
				return graphNode;
			});
			return {
				nodes,
				...(typeof body?.offset === "number" ? { offset: body.offset } : {}),
				// Absent means absent: no fallback to `nodes.length` / `false`. See
				// `QueryGraphNodesResult`'s doc for why a guess here is worse than
				// saying "unknown".
				stored: typeof body?.stored === "number" ? body.stored : undefined,
				truncated: typeof body?.truncated === "boolean" ? body.truncated : undefined,
			};
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

/**
 * The per-device bearer credential (`refarm auth enroll`), from `FARM_TOKEN`.
 * Absent or empty (the default, ungated farm) ⇒ `undefined`, so no header is
 * added and behavior is byte-identical to before the auth gate existed.
 */
function resolveFarmToken(env: NodeJS.ProcessEnv): string | undefined {
	const token = typeof env.FARM_TOKEN === "string" ? env.FARM_TOKEN.trim() : "";
	return token.length > 0 ? token : undefined;
}

/** Case-insensitive `Authorization` presence check across all three `HeadersInit`
 * shapes (`Headers`, an array of pairs, a plain object) — a caller-supplied header
 * must win regardless of which shape it arrives in. */
function hasAuthorizationHeader(headers: HeadersInit | undefined): boolean {
	if (!headers) return false;
	if (headers instanceof Headers) {
		return headers.has("authorization");
	}
	if (Array.isArray(headers)) {
		return headers.some(([key]) => key.toLowerCase() === "authorization");
	}
	return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

/** Attach `Authorization: Bearer <token>` unless the caller already set one
 * (any casing, any `HeadersInit` shape) — never clobber an explicit header. */
function withFarmTokenAuthorization(init: RequestInit, token: string): RequestInit {
	if (hasAuthorizationHeader(init.headers)) return init;
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${token}`);
	return { ...init, headers };
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
 *
 * This is also the single choke point that attaches the device's auth-gate
 * credential: when `FARM_TOKEN` is set and non-empty, every call gets
 * `Authorization: Bearer <token>` unless the caller already set that header.
 * Absent/empty `FARM_TOKEN` ⇒ no header at all, byte-identical to before the
 * gate existed. The token is never logged and never surfaces in a thrown error.
 */
export async function fetchSidecarWithTimeout(
	url: string | URL,
	init: RequestInit = {},
	options: SidecarRequestOptions = {},
): Promise<Response> {
	const token = resolveFarmToken(options.env ?? process.env);
	const requestInit = token ? withFarmTokenAuthorization(init, token) : init;
	return fetchWithTimeout(url, requestInit, {
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

/**
 * Re-exported so a caller of this HTTP client reads a page with the SAME vocabulary a caller of a
 * storage adapter does. The judgement is ONE function, in `@refarm.dev/storage-contract-v1`;
 * nineteen consumer files were each inventing their own, which is how "there are none" and
 * "nobody could tell" got collapsed into one answer in the first place (ISS-040).
 */
export { readCompleteness, type ReadCompleteness, type QueryNodesPage };
