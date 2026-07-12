import type { WebFetchDriver, WebFetchRequest, WebFetchResult } from "./types.js";

/**
 * A fetch driver's HTTP error, carrying the status so the caller can treat some statuses as
 * RECOVERABLE. A real ALM (IBM Jazz) answers an expired session with HTTP 401 mid-run; the
 * scrape should re-authenticate and retry rather than fail. A driver throws this; the session
 * gate / caller decides what to do (see `isRecoverableAuthStatus`).
 */
export class HttpFetchError extends Error {
	readonly status: number;
	readonly url: string;
	constructor(status: number, url: string, message?: string) {
		super(message ?? `HTTP ${status} fetching ${url}`);
		this.name = "HttpFetchError";
		this.status = status;
		this.url = url;
	}
}

/** Is this HTTP status a recoverable AUTH failure — i.e. "your session expired, re-login and
 * retry" rather than a hard error? 401 (and 419, some gateways) are the re-auth signals. */
export function isRecoverableAuthStatus(status: number): boolean {
	return status === 401 || status === 419;
}

/** Re-authenticate after a recoverable failure: given the request that failed (its session +
 * url identify what to re-login to), return a FRESH session to retry with. The consumer wires
 * this to their login (the same driver login-garantido uses). */
export type Reauthenticate = (failed: WebFetchRequest) => Promise<WebFetchRequest["session"]>;

export interface WithReauthOptions {
	reauth: Reauthenticate;
	/** Which statuses trigger a re-auth+retry (default: {@link isRecoverableAuthStatus}). */
	isRecoverable?: (status: number) => boolean;
	/** How many times to re-auth+retry before giving up (default 1 — one refreshed attempt). */
	maxRetries?: number;
}

/**
 * Wrap a fetch driver so a recoverable auth failure (a Jazz session expiring mid-pull → 401)
 * is handled the way the real vault handles it: re-authenticate, then retry the fetch with the
 * FRESH session — up to `maxRetries` times, then rethrow. This is the substrate's generic
 * session-recovery loop; the domain driver underneath just does the GET and throws
 * HttpFetchError on 401. A non-recoverable error (403/500) propagates untouched.
 */
export function withReauth(fetcher: WebFetchDriver, options: WithReauthOptions): WebFetchDriver {
	const isRecoverable = options.isRecoverable ?? isRecoverableAuthStatus;
	const maxRetries = options.maxRetries ?? 1;
	return async (request: WebFetchRequest): Promise<WebFetchResult> => {
		let attempt = 0;
		let current = request;
		for (;;) {
			try {
				return await fetcher(current);
			} catch (error) {
				const recoverable =
					error instanceof HttpFetchError && isRecoverable(error.status) && attempt < maxRetries;
				if (!recoverable) throw error;
				attempt += 1;
				const session = await options.reauth(current); // re-login → fresh session
				current = { ...current, session };
			}
		}
	};
}

/**
 * The default fetch driver: a plain `fetch()` GET that sends the caller's headers and the
 * session's `credentialRef` as a bearer-ish hint (a real driver replaces this with cookie
 * replay / a browser context — see the reqbench OSLC driver). Maps a non-OK response to
 * `HttpFetchError` so 401 stays recoverable. Kept minimal on purpose: the SUBSTRATE ships a
 * usable-but-generic fetcher; domain drivers (OSLC/RDF) are injected by the consumer.
 */
export function createHttpFetchDriver(options: { fetchImpl?: typeof fetch } = {}): WebFetchDriver {
	const doFetch = options.fetchImpl ?? fetch;
	return async (request: WebFetchRequest): Promise<WebFetchResult> => {
		const response = await doFetch(request.url, {
			method: "GET",
			headers: request.headers ?? {},
		});
		if (!response.ok) {
			throw new HttpFetchError(response.status, request.url);
		}
		const body = await response.text();
		const mediaType = response.headers.get("content-type") ?? "application/octet-stream";
		return { body, mediaType };
	};
}
