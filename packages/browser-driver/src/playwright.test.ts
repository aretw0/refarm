import { describe, expect, it } from "vitest";
import {
	createPlaywrightSession,
	type PlaywrightBrowserContextLike,
	type PlaywrightChromiumLike,
	type PlaywrightCookieLike,
	type PlaywrightPageLike,
} from "./playwright.js";

/**
 * The Playwright adapter's translation logic (login poll, cookie capture, in-session fetch,
 * navigate, close) tested against a FAKE chromium — no real browser, per the package's design.
 * The browser-agnostic detection loop itself is tested in session.test.ts (awaitLoginDetected).
 */

interface FakeControls {
	gotos: string[];
	waited: string[];
	evaluated: Array<{ target: string; headers: Record<string, string> }>;
	contextClosed: () => boolean;
	launchOptions: () => { headless?: boolean; executablePath?: string; args?: string[] } | undefined;
}

function fakeChromium(config: {
	cookies: PlaywrightCookieLike[];
	evaluateResult?: { status: number; statusText: string; headers: Record<string, string>; body: string };
	selectorPresent?: boolean;
}): { chromium: PlaywrightChromiumLike; controls: FakeControls } {
	const gotos: string[] = [];
	const waited: string[] = [];
	const evaluated: Array<{ target: string; headers: Record<string, string> }> = [];
	let contextClosed = false;
	let launchOptions: { headless?: boolean; executablePath?: string; args?: string[] } | undefined;
	let currentUrl = "about:blank";

	const page: PlaywrightPageLike = {
		async goto(url) {
			gotos.push(url);
			currentUrl = url;
			return null;
		},
		url: () => currentUrl,
		async $(_selector) {
			return config.selectorPresent ? {} : null;
		},
		async evaluate(_pageFunction, arg) {
			evaluated.push({ target: arg.target, headers: arg.headers });
			return (
				config.evaluateResult ?? {
					status: 200,
					statusText: "OK",
					headers: { "content-type": "application/rdf+xml" },
					body: "<rdf/>",
				}
			);
		},
		async waitForSelector(selector) {
			waited.push(selector);
			return {};
		},
		async close() {},
	};

	const context: PlaywrightBrowserContextLike = {
		async newPage() {
			return page;
		},
		async cookies() {
			return config.cookies;
		},
		async close() {
			contextClosed = true;
		},
	};

	const chromium: PlaywrightChromiumLike = {
		async launchPersistentContext(_userDataDir, options) {
			launchOptions = options;
			return context;
		},
	};

	return {
		chromium,
		controls: {
			gotos,
			waited,
			evaluated,
			contextClosed: () => contextClosed,
			launchOptions: () => launchOptions,
		},
	};
}

describe("createPlaywrightSession — BrowserSession over a (fake) Playwright chromium", () => {
	it("logs in (URL left the flow, host matches) and captures the context cookies", async () => {
		const { chromium } = fakeChromium({
			cookies: [{ name: "JSESSIONID", value: "abc", domain: "app.example", path: "/" }],
		});
		const session = await createPlaywrightSession({ chromium, sleep: async () => {} });

		const cookies = await session.ensureLoggedIn("https://app.example");

		expect(cookies).toEqual([{ name: "JSESSIONID", value: "abc", domain: "app.example", path: "/" }]);
	});

	it("launches a PERSISTENT context, visible (headless:false) with --no-first-run", async () => {
		const { chromium, controls } = fakeChromium({ cookies: [] });
		await createPlaywrightSession({ chromium });

		expect(controls.launchOptions()?.headless).toBe(false);
		expect(controls.launchOptions()?.args).toContain("--no-first-run");
	});

	it("fetchInSession runs the GET inside the page, passing domain headers, returning a Response", async () => {
		const { chromium, controls } = fakeChromium({
			cookies: [],
			evaluateResult: {
				status: 200,
				statusText: "OK",
				headers: { "content-type": "application/rdf+xml" },
				body: "<rdf/>",
			},
		});
		const session = await createPlaywrightSession({ chromium });

		const response = await session.fetchInSession!("https://app.example/rm/resources/TX_1", {
			headers: { "DoorsRP-Request-Type": "private" },
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<rdf/>");
		expect(controls.evaluated[0]?.target).toBe("https://app.example/rm/resources/TX_1");
		expect(controls.evaluated[0]?.headers["DoorsRP-Request-Type"]).toBe("private");
		// Parked on the target origin first, so the page's cookies apply.
		expect(controls.gotos).toContain("https://app.example");
	});

	it("navigateInSession drives the page to the URL and waits for the caller's selector", async () => {
		const { chromium, controls } = fakeChromium({ cookies: [], selectorPresent: true });
		const session = await createPlaywrightSession({ chromium });

		await session.navigateInSession!("https://app.example/rm/web#action=com.ibm.rdm.web.pages.showArtifact", {
			waitForSelector: ".artifact-loaded",
		});

		expect(controls.gotos).toContain("https://app.example/rm/web#action=com.ibm.rdm.web.pages.showArtifact");
		expect(controls.waited).toContain(".artifact-loaded");
	});

	it("close() closes the browser context", async () => {
		const { chromium, controls } = fakeChromium({ cookies: [] });
		const session = await createPlaywrightSession({ chromium });

		await session.close();

		expect(controls.contextClosed()).toBe(true);
	});
});
