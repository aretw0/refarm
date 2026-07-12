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
