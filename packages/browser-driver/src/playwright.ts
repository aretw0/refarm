import {
	awaitLoginDetected,
	type BrowserSession,
	type LoginSignals,
	type SessionCookie,
} from "./session.js";

/**
 * The Playwright BrowserSession adapter — the Playwright sibling of ./puppeteer, and the ONLY
 * Playwright-touching module. It satisfies the same `BrowserSession` interface, so every caller
 * (createLiveFetch, a domain OSLC/REST/HTML client, an agent tool) is unchanged whether the
 * operator drives puppeteer or Playwright.
 *
 * Kept thin: the browser-agnostic login-detection loop lives in ./session (awaitLoginDetected),
 * shared with puppeteer; this module only translates the `BrowserSession` verbs onto Playwright's
 * `BrowserContext`/`Page` API. Playwright is loaded LAZILY (dynamic import of `playwright-core`,
 * then `playwright`) and — crucially — the `chromium` BrowserType is INJECTABLE, so the adapter's
 * translation logic is unit-tested against a fake, with no real browser (the package's design
 * goal: "testable with a fake"). A consumer brings its OWN specific login as its `LoginSignals`
 * (e.g. rcdc5's SerproID redirect); nothing here is tied to a site.
 *
 * Uses a PERSISTENT context (launchPersistentContext) so an SSO/VPN login done once is reused
 * across runs — the operator's own Chrome, downloading nothing (with playwright-core).
 */

/** One cookie as Playwright's BrowserContext returns it (a superset of what we keep). */
export interface PlaywrightCookieLike {
	name: string;
	value: string;
	domain?: string;
	path?: string;
}

interface InSessionArg {
	target: string;
	headers: Record<string, string>;
}
interface InSessionResult {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
}

/** The minimal slice of Playwright's `Page` the adapter drives. */
export interface PlaywrightPageLike {
	goto(url: string, options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle" | "commit" }): Promise<unknown>;
	url(): string;
	$(selector: string): Promise<unknown | null>;
	evaluate(pageFunction: (arg: InSessionArg) => Promise<InSessionResult>, arg: InSessionArg): Promise<InSessionResult>;
	waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
	close(): Promise<void>;
}

/** The minimal slice of Playwright's `BrowserContext` the adapter drives. */
export interface PlaywrightBrowserContextLike {
	newPage(): Promise<PlaywrightPageLike>;
	cookies(): Promise<PlaywrightCookieLike[]>;
	close(): Promise<void>;
}

/** The minimal slice of Playwright's `chromium` BrowserType the adapter needs — the injection seam. */
export interface PlaywrightChromiumLike {
	launchPersistentContext(
		userDataDir: string,
		options?: { headless?: boolean; executablePath?: string; args?: string[] },
	): Promise<PlaywrightBrowserContextLike>;
}

export interface PlaywrightSessionOptions {
	/** Path to the operator's Chrome/Chromium. If omitted, CHROME_PATH, then Playwright's lookup. */
	executablePath?: string;
	/** The persistent profile dir — the session store (cookies survive here across runs). Empty
	 * string (default) uses an ephemeral temporary profile, so login is NOT reused. */
	userDataDir?: string;
	/** Run headless. Default false: the human must SEE the browser to complete SSO/VPN login. */
	headless?: boolean;
	/** How long to wait for login to be auto-detected (ms). Default 3 min. */
	loginTimeoutMs?: number;
	/** How login-complete is detected (no keypress). Defaults to "URL reached baseUrl host and
	 * left the login flow". */
	signals?: LoginSignals;
	/** Injected Playwright `chromium` BrowserType — for tests (a fake). Defaults to a lazy dynamic
	 * import of `playwright-core`, then `playwright`. */
	chromium?: PlaywrightChromiumLike;
	/** Clock/sleep for the login loop — injected in tests for determinism. */
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

/** Lazily resolve Playwright's `chromium` — `playwright-core` first (downloads no browser), then
 * `playwright`. A non-literal specifier keeps this off the build's module graph, so the package
 * type-checks and ships without Playwright installed; a consumer brings it. */
async function importPlaywrightChromium(): Promise<PlaywrightChromiumLike> {
	for (const spec of ["playwright-core", "playwright"]) {
		try {
			const mod = (await import(spec)) as unknown as { chromium?: PlaywrightChromiumLike };
			if (mod.chromium) return mod.chromium;
		} catch {
			// try the next specifier
		}
	}
	throw new Error(
		"BROWSER_DRIVER_UNAVAILABLE: neither `playwright-core` nor `playwright` is installed. " +
			"Driving a browser login with the Playwright adapter needs one. Install it " +
			"(pnpm add playwright-core) and make sure Chromium is available (set executablePath or CHROME_PATH).",
	);
}

/**
 * Create a BrowserSession backed by Playwright's chromium. The heavy dependency is imported
 * lazily and only when no `chromium` is injected, so nothing pulls Playwright in until a live run
 * constructs this without a fake.
 */
export async function createPlaywrightSession(
	options: PlaywrightSessionOptions = {},
): Promise<BrowserSession> {
	const chromium = options.chromium ?? (await importPlaywrightChromium());
	const context = await chromium.launchPersistentContext(options.userDataDir ?? "", {
		headless: options.headless ?? false,
		...(options.executablePath ?? process.env.CHROME_PATH
			? { executablePath: options.executablePath ?? process.env.CHROME_PATH }
			: {}),
		args: ["--no-first-run"],
	});

	/** The authenticated page, kept open after login so `fetchInSession` can request from it. */
	let sessionPage: PlaywrightPageLike | undefined;

	return {
		async ensureLoggedIn(baseUrl: string): Promise<SessionCookie[]> {
			const page = await context.newPage();
			await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

			// Default the URL marker to the baseUrl host (mirrors the puppeteer adapter), then poll
			// the browser-agnostic detector — the human just completes SSO/VPN in the window.
			const signals: LoginSignals = {
				...(options.signals ?? {}),
				urlIncludes: options.signals?.urlIncludes ?? new URL(baseUrl).host,
			};
			await awaitLoginDetected(
				{
					currentUrl: () => page.url(),
					hasSelector: async (selector) => (await page.$(selector)) !== null,
					hasCookie: async (name) => (await context.cookies()).some((c) => c.name === name),
				},
				signals,
				{ timeoutMs: options.loginTimeoutMs, now: options.now, sleep: options.sleep },
			);

			// KEEP the page open as the session page (see fetchInSession) — cookies live on the context.
			sessionPage = page;
			const raw = await context.cookies();
			return raw.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
		},

		/**
		 * GET through the AUTHENTICATED PAGE (Playwright `page.evaluate` running fetch in-browser),
		 * not a detached fetch — so the request carries the browser's trust store (corporate/internal
		 * CA), correct cookie scoping, and any session cookie the app mints during the run (the exact
		 * thing a cookie-replay fetch fails on for a Jazz `/rm` app session). Same-origin is required
		 * for the page's cookies to apply, so the page is parked on the target origin first.
		 */
		async fetchInSession(url: string, init?: { headers?: Record<string, string> }) {
			const page = sessionPage ?? (sessionPage = await context.newPage());
			const origin = new URL(url).origin;
			if (!page.url().startsWith(origin)) {
				await page.goto(origin, { waitUntil: "domcontentloaded" });
			}
			const result = await page.evaluate(
				async ({ target, headers }) => {
					const response = await fetch(target, { headers, credentials: "include" });
					const collected: Record<string, string> = {};
					response.headers.forEach((value, key) => {
						collected[key] = value;
					});
					return {
						status: response.status,
						statusText: response.statusText,
						headers: collected,
						body: await response.text(),
					};
				},
				{ target: url, headers: init?.headers ?? {} },
			);

			return new Response(result.body, {
				status: result.status,
				statusText: result.statusText,
				headers: result.headers,
			});
		},

		/**
		 * Drive the session's page to `url` and let it settle — some enterprise SPAs only put a
		 * resource in scope once their UI has opened on it. Settle on the caller's selector when
		 * known, else give the app a brief moment (a hash-route change fires no navigation event).
		 */
		async navigateInSession(url: string, navOptions?: { waitForSelector?: string }) {
			const page = sessionPage ?? (sessionPage = await context.newPage());
			await page.goto(url, { waitUntil: "domcontentloaded" });
			if (navOptions?.waitForSelector) {
				await page
					.waitForSelector(navOptions.waitForSelector, { timeout: 30_000 })
					.catch(() => undefined); // absent selector is a signal, not a crash
			} else {
				await (options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(2_500);
			}
		},

		async close(): Promise<void> {
			sessionPage = undefined;
			await context.close();
		},
	};
}
