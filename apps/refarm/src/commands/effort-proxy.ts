import type { IncomingMessage, ServerResponse } from "node:http";

import { fetchWithTimeout } from "@refarm.dev/root";

import { resolveSidecarUrl } from "./sidecar-url.js";

/**
 * ADR-088: the same-origin effort proxy. A browser chat face served by `refarm serve`
 * (`:4321`) must submit/cancel efforts on the runtime sidecar (`:42001`), but a direct
 * cross-origin POST would need CORS on the runtime. Instead this handler proxies
 * `/efforts*` from the serve origin to the sidecar, so the browser talks ONLY to its own
 * origin (zero CORS by default; the sidecar's network surface stays closed unless CORS
 * is explicitly opted into). Everything else falls through to `next`.
 *
 * Deliberately narrow: only the `/efforts` prefix is proxied (submit, GET result, cancel,
 * retry, logs) — the surface a chat face needs — not the whole sidecar. The forward
 * preserves method, body, and content-type; the sidecar's status/body are returned
 * verbatim. Pure over the injected `resolveSidecar`/`fetchImpl` so it is unit-testable.
 */

const EFFORT_PROXY_PREFIX = "/efforts";
/** Cap the proxied request body so a client can't stream an unbounded payload. */
const MAX_PROXY_BODY_BYTES = 1024 * 1024;

/** The proxy only ever fetches a resolved string URL — narrower than the DOM `fetch`,
 * so it composes with `fetchWithTimeout` (which takes `string | URL`). */
export type EffortProxyFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface EffortProxyOptions {
	/** Resolve the sidecar base URL (defaults to the env/config resolver). */
	resolveSidecar?: (env: NodeJS.ProcessEnv) => string;
	/** Injected fetch (defaults to the timeout fetch) — for tests. */
	fetchImpl?: EffortProxyFetch;
	env?: NodeJS.ProcessEnv;
}

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** Is this request one the effort proxy should handle? Path-prefix match on `/efforts`. */
export function isEffortProxyRequest(url: string | undefined): boolean {
	if (!url) return false;
	const path = url.split("?")[0] ?? "";
	return path === EFFORT_PROXY_PREFIX || path.startsWith(`${EFFORT_PROXY_PREFIX}/`);
}

/** Read the request body up to a byte cap; rejects if the cap is exceeded. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		req.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > maxBytes) {
				reject(new Error("effort proxy: request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

/**
 * Wrap a Node request handler with the effort proxy. Requests to `/efforts*` are
 * forwarded to the sidecar; all others pass through to `next` unchanged.
 */
export function createEffortProxyHandler(
	next: NodeHandler,
	options: EffortProxyOptions = {},
): NodeHandler {
	const env = options.env ?? process.env;
	const resolveSidecar = options.resolveSidecar ?? ((e) => resolveSidecarUrl(e));
	const fetchImpl = options.fetchImpl ?? ((input, init) => fetchWithTimeout(input, init, { env }));

	return (req, res) => {
		if (!isEffortProxyRequest(req.url)) {
			next(req, res);
			return;
		}

		void (async () => {
			try {
				const base = resolveSidecar(env).replace(/\/$/, "");
				const target = `${base}${req.url}`;
				const method = req.method ?? "GET";
				const hasBody = method !== "GET" && method !== "HEAD";
				const body = hasBody ? await readBody(req, MAX_PROXY_BODY_BYTES) : undefined;

				const headers: Record<string, string> = {};
				const contentType = req.headers["content-type"];
				if (contentType) headers["content-type"] = contentType;

				const upstream = await fetchImpl(target, {
					method,
					headers,
					body: body && body.length > 0 ? body : undefined,
				});

				const text = await upstream.text();
				res.statusCode = upstream.status;
				const upstreamType = upstream.headers.get("content-type");
				res.setHeader("content-type", upstreamType ?? "application/json");
				res.end(text);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				res.statusCode = 502;
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify({ ok: false, error: "effort-proxy-failed", message }));
			}
		})();
	};
}
