import type { BrowserSession, SessionCookie } from "./session.js";

/**
 * The puppeteer-core BrowserSession adapter — the ONLY module that touches a real browser,
 * kept thin and LAZILY loaded (import it dynamically, only when a live run needs it) so nothing
 * else pulls puppeteer in, and a machine/CI without Chrome still runs everything else.
 *
 * It uses the operator's OWN installed Chrome (puppeteer-core downloads nothing) with a
 * PERSISTENT user-data-dir, so the SSO/VPN login they do once is reused across runs. Login is
 * AUTO-DETECTED (no "press Enter"): the adapter waits until the page leaves the login/SSO flow
 * AND any of the caller's success signals is met — a URL marker, a CSS selector, or an auth
 * cookie. This mirrors a real vault's URL/selector-based auth detection.
 *
 * It can't be unit-tested where there is no Chrome; the operator runs it. The testable logic
 * lives in ./session (behind the BrowserSession interface), which this satisfies.
 */

export interface LoginSignals {
	/** Success when the page URL includes this substring (e.g. the dashboard path). */
	urlIncludes?: string;
	/** Success when this CSS selector appears (e.g. a dashboard element only shown when authed). */
	readySelector?: string;
	/** Success when a cookie with this name is set (the session cookie, e.g. "JSESSIONID"). */
	cookieNamed?: string;
	/** URL fragments that mean "still logging in" — success requires the URL NOT to match these
	 * (default: /login|sso|auth|signin/). */
	loginUrlPattern?: string;
}

export interface PuppeteerSessionOptions {
	/** Path to the operator's Chrome. If omitted, CHROME_PATH, then puppeteer's own lookup. */
	executablePath?: string;
	/** The persistent profile dir — the session store (cookies survive here across runs). */
	userDataDir?: string;
	/** Run headless. Default false: the human must SEE the browser to complete SSO/VPN login. */
	headless?: boolean;
	/** How long to wait for login to be auto-detected (ms). Default 3 min. */
	loginTimeoutMs?: number;
	/** How login-complete is detected (no keypress). Defaults to "URL reached baseUrl host and
	 * left the login flow". */
	signals?: LoginSignals;
}

/**
 * Create a BrowserSession backed by puppeteer-core. Imports puppeteer-core dynamically so the
 * dependency is only required when this is actually constructed. Throws a clear, actionable
 * error if puppeteer-core isn't installed.
 */
export async function createPuppeteerSession(
	options: PuppeteerSessionOptions = {},
): Promise<BrowserSession> {
	let puppeteer: typeof import("puppeteer-core");
	try {
		puppeteer = (await import("puppeteer-core")) as typeof import("puppeteer-core");
	} catch {
		throw new Error(
			"BROWSER_DRIVER_UNAVAILABLE: `puppeteer-core` is not installed. Driving a browser login " +
				"needs it. Install it (pnpm add puppeteer-core) and make sure Chrome is available " +
				"(set executablePath or CHROME_PATH).",
		);
	}

	const browser = await puppeteer.launch({
		executablePath: options.executablePath ?? process.env.CHROME_PATH,
		userDataDir: options.userDataDir,
		headless: options.headless ?? false,
		args: ["--no-first-run"],
	});

	/** The authenticated page, kept open after login so `fetchInSession` can request from it. */
	let sessionPage: Awaited<ReturnType<typeof browser.newPage>> | undefined;

	return {
		async ensureLoggedIn(baseUrl: string): Promise<SessionCookie[]> {
			const page = await browser.newPage();
			await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

			const signals = options.signals ?? {};
			const urlMarker = signals.urlIncludes ?? new URL(baseUrl).host;
			const loginPattern = signals.loginUrlPattern ?? "login|sso|auth|signin";
			const timeout = options.loginTimeoutMs ?? 180_000;

			// AUTO-DETECT login (no Enter). Poll for: URL left the login flow AND (URL marker is
			// present) — and separately, if configured, a ready selector or an auth cookie. The
			// human just completes SSO/VPN in the window; the loop notices when it's done.
			const cookieNamed = signals.cookieNamed;
			const readySelector = signals.readySelector;
			const deadline = Date.now() + timeout; // wall clock is fine here (real browser run)
			for (;;) {
				const url = page.url();
				const notLoggingIn = !new RegExp(loginPattern, "i").test(url);
				const urlOk = url.includes(urlMarker);
				let selectorOk = true;
				if (readySelector) selectorOk = (await page.$(readySelector)) !== null;
				let cookieOk = true;
				if (cookieNamed) {
					const jar = await page.cookies();
					cookieOk = jar.some((c) => c.name === cookieNamed);
				}
				if (notLoggingIn && urlOk && selectorOk && cookieOk) break;
				if (Date.now() > deadline) {
					await page.close();
					throw new Error(
						"BROWSER_LOGIN_TIMEOUT: timed out waiting for login to be detected. Finish signing " +
							"in (VPN + SSO) within the window, or raise loginTimeoutMs / tune signals.",
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			const raw = await page.cookies();
			// KEEP the page open as the session page: `fetchInSession` issues requests from inside
			// it, so the browser stays the one thing that holds the session. Closing here is what
			// forced the detached-cookie path, and with it the whole class of problems below.
			sessionPage = page;
			return raw.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
		},

		/**
		 * GET through the AUTHENTICATED PAGE instead of a detached fetch — the single most
		 * important thing a real ALM run needs, and the reason a cookie-replay fetch fails against
		 * one. Running `fetch` inside the page means the BROWSER owns the request, so it brings:
		 *
		 * - the operator's system trust store (a corporate/internal CA just works; Node's fetch
		 *   ships Mozilla's list and fails such a host with SELF_SIGNED_CERT_IN_CHAIN);
		 * - correct cookie semantics — path scoping, httpOnly, SameSite, and cookies the app mints
		 *   DURING the run (a Jazz `/rm` app session is issued only when the app is first reached,
		 *   and a jar captured before that never contains it);
		 * - session renewal, so a long crawl does not decay.
		 *
		 * Same-origin is required for the page's cookies to apply, so the page is parked on the
		 * target origin first. Returns a real Response, so callers stay `fetch`-shaped.
		 */
		async fetchInSession(url: string, init?: { headers?: Record<string, string> }) {
			const page = sessionPage ?? (sessionPage = await browser.newPage());
			const origin = new URL(url).origin;
			if (!page.url().startsWith(origin)) {
				await page.goto(origin, { waitUntil: "domcontentloaded" });
			}
			const result = (await page.evaluate(
				async (target: string, headers: Record<string, string>) => {
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
				url,
				init?.headers ?? {},
			)) as { status: number; statusText: string; headers: Record<string, string>; body: string };

			return new Response(result.body, {
				status: result.status,
				statusText: result.statusText,
				headers: result.headers,
			});
		},

		/**
		 * Drive the session's page to `url`. A hash-route change (the shape enterprise SPAs use
		 * for deep links) does not trigger a navigation event, so a plain `goto` can resolve
		 * before the app has actually loaded anything: settle on the selector when the caller
		 * knows one, and otherwise give the app a brief moment to react.
		 */
		async navigateInSession(url: string, navOptions?: { waitForSelector?: string }) {
			const page = sessionPage ?? (sessionPage = await browser.newPage());
			await page.goto(url, { waitUntil: "domcontentloaded" });
			if (navOptions?.waitForSelector) {
				await page
					.waitForSelector(navOptions.waitForSelector, { timeout: 30_000 })
					.catch(() => undefined); // absent selector is a signal, not a crash
			} else {
				await new Promise((resolve) => setTimeout(resolve, 2_500));
			}
		},

		async close(): Promise<void> {
			sessionPage = undefined;
			await browser.close();
		},
	};
}
