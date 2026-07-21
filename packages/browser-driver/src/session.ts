import { readFileSync, writeFileSync } from "node:fs";
import type { WebFetchDriver, WebFetchRequest, WebFetchResult } from "@refarm.dev/source-web";

/**
 * A light, injectable BROWSER-LOGIN driver for web sources — the framework block that lets any
 * consumer (an example, an app, or an AGENT operator) drive a real browser to sign in once
 * (SSO/VPN happen in the window), then reuse that session's cookies for authenticated fetches.
 *
 * The design keeps the browser behind the `BrowserSession` interface, so:
 *  - it's testable with a fake (no real Chrome needed to test the login/reuse logic),
 *  - the heavy dependency (a browser automation lib) is isolated in the adapter and loaded
 *    lazily (see ./puppeteer), so nothing here pulls it in,
 *  - a consumer can bring ANY browser (puppeteer, Playwright, CDP) without changing callers.
 *
 * The cookie→fetch bridge is pure. `createLiveFetch` returns a generic cookie-carrying
 * WebFetchDriver; a domain client (REST / GraphQL / RDF / HTML) wraps it with its own request
 * contract. Nothing here is tied to a particular site, protocol, or use — it's a base block for
 * ANY authenticated scraping or automation, driven by a playbook or an agent tool.
 */

/** One cookie captured from the authenticated browser session. */
export interface SessionCookie {
	name: string;
	value: string;
	domain?: string;
	path?: string;
}

/** What the driver needs from a browser: sign in (blocking until authenticated is DETECTED —
 * no human keypress) and hand back the session cookies. Implemented by an adapter (puppeteer,
 * Playwright, CDP); faked in tests. */
export interface BrowserSession {
	/** Ensure an authenticated session for `baseUrl`, returning its cookies. For a real browser
	 * this blocks until login is auto-detected (URL/selector/cookie signals), never on Enter. */
	ensureLoggedIn(baseUrl: string): Promise<SessionCookie[]>;
	/**
	 * OPTIONAL: serve a request from INSIDE the authenticated session, rather than replaying its
	 * cookies from outside. An adapter that can do this should — see `createLiveFetch`, which
	 * prefers it. Cookie replay is the portable fallback, not the better option: it drops the
	 * browser's trust store, cookie path/httpOnly scoping, and any cookie the app mints later.
	 */
	fetchInSession?(url: string, init?: { headers?: Record<string, string> }): Promise<Response>;
	close(): Promise<void>;
}

/** Serialize cookies into a `Cookie` request header value. */
export function cookieHeader(cookies: SessionCookie[]): string {
	return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Turn a cookie jar into a fetch impl that replays those cookies on every request — the bridge
 * from "logged in in the browser" to "the fetches are authenticated". Wraps the injected base
 * fetch (default global fetch); adds the Cookie header, preserving any caller headers.
 */
export function cookieFetch(cookies: SessionCookie[], base: typeof fetch = fetch): typeof fetch {
	const cookie = cookieHeader(cookies);
	return ((input: RequestInfo | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		if (cookie) headers.set("Cookie", cookie);
		return base(input, { ...init, headers });
	}) as typeof fetch;
}

/** Read a persisted cookie storageState file (the reused session). Empty on missing/bad file
 * — a first run has none, and the driver then logs in. */
export function loadCookieState(statePath: string): SessionCookie[] {
	try {
		const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as { cookies?: SessionCookie[] };
		return Array.isArray(parsed.cookies) ? parsed.cookies : [];
	} catch {
		return [];
	}
}

/** Persist the session cookies (storageState) for reuse on the next run. */
export function saveCookieState(statePath: string, cookies: SessionCookie[]): void {
	writeFileSync(statePath, `${JSON.stringify({ cookies }, null, 2)}\n`);
}

/** Wrap ANY authenticated fetch impl as a WebFetchDriver — the base a domain driver wraps with
 * its own headers. How the fetch got its authority (replayed cookies, or the browser session
 * itself) is not this function's business. */
export function createFetchDriver(doFetch: typeof fetch): WebFetchDriver {
	return async (request: WebFetchRequest): Promise<WebFetchResult> => {
		const response = await doFetch(request.url, {
			method: "GET",
			headers: request.headers ?? {},
		});
		const body = await response.text();
		const mediaType = response.headers.get("content-type") ?? "application/octet-stream";
		return { body, mediaType };
	};
}

/** A plain cookie-carrying fetch driver: every request gets the session's Cookie header. */
export function createCookieFetchDriver(
	cookies: SessionCookie[],
	base: typeof fetch = fetch,
): WebFetchDriver {
	return createFetchDriver(cookieFetch(cookies, base));
}

export interface LiveFetchOptions {
	/** The browser session (real adapter, or a fake in tests). */
	session: BrowserSession;
	/** The base URL to authenticate against (e.g. https://app.example). */
	baseUrl: string;
	/** Where to persist/reuse the cookie storageState. */
	statePath?: string;
	/** Base fetch the cookie fetch wraps (default global fetch). */
	fetchImpl?: typeof fetch;
}

export interface LiveFetch {
	/** The authenticated fetch impl — hand to a provider's `fetchImpl`. */
	fetchImpl: typeof fetch;
	/** A ready authenticated WebFetchDriver — for a consumer that wants the driver directly. */
	driver: WebFetchDriver;
	/** The captured session cookies (empty when requests are served from inside the session). */
	cookies: SessionCookie[];
	/**
	 * Release the session. Required when requests are served from inside the browser — it is
	 * still open, and holding the session. A no-op on the detached cookie path, so callers can
	 * always call it.
	 */
	close(): Promise<void>;
}

/**
 * Log in via the browser once (or reuse a persisted session), and return an authenticated
 * `fetchImpl` + a cookie-carrying `WebFetchDriver`. This is the framework entry an operator
 * (or an agent) uses to get an authenticated handle to a system behind SSO/VPN. The browser is
 * closed after cookies are captured (fetches don't need it open).
 */
export async function createLiveFetch(options: LiveFetchOptions): Promise<LiveFetch> {
	const inSession = options.session.fetchInSession?.bind(options.session);

	// A session that can serve requests itself ALWAYS logs in fresh: a persisted jar is an
	// optimization for the detached path only, and reusing one here would skip the very
	// navigation that makes the app mint its own session cookie.
	let cookies: SessionCookie[] = inSession
		? []
		: options.statePath
			? loadCookieState(options.statePath)
			: [];
	if (cookies.length === 0) {
		cookies = await options.session.ensureLoggedIn(options.baseUrl);
		if (options.statePath && !inSession) saveCookieState(options.statePath, cookies);
	}

	if (inSession) {
		// The browser STAYS OPEN — it is what holds the session. The caller closes it.
		const fetchImpl = sessionFetch(inSession);
		return {
			fetchImpl,
			driver: createFetchDriver(fetchImpl),
			cookies,
			close: () => options.session.close(),
		};
	}

	await options.session.close();
	const base = options.fetchImpl ?? fetch;
	return {
		fetchImpl: cookieFetch(cookies, base),
		driver: createCookieFetchDriver(cookies, base),
		cookies,
		close: async () => {},
	};
}

/** Adapt a session's own request method to the `fetch` shape callers already expect. */
export function sessionFetch(
	inSession: (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>,
): typeof fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			headers[key] = value;
		});
		return inSession(url, { headers });
	}) as typeof fetch;
}
