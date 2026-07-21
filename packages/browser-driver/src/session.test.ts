import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
	cookieFetch,
	cookieHeader,
	createCookieFetchDriver,
	createLiveFetch,
	loadCookieState,
	saveCookieState,
	type BrowserSession,
	type SessionCookie,
} from "./index.js";

const COOKIES: SessionCookie[] = [
	{ name: "JSESSIONID", value: "abc", domain: "app.example" },
	{ name: "CSRFTOKEN", value: "Form", domain: "app.example" },
];

function tmpFile(): string {
	return path.join(mkdtempSync(path.join(os.tmpdir(), "browser-driver-")), "auth-state.json");
}

/** A fake browser session — stands in for a real browser so the login/reuse logic is testable
 * with no Chrome. */
function fakeSession(cookies: SessionCookie[], onLogin?: () => void): BrowserSession {
	return {
		async ensureLoggedIn() {
			onLogin?.();
			return cookies;
		},
		async close() {},
	};
}

/** A fake session that can serve requests itself — the shape a real browser adapter has. */
function fakeInSessionBrowser(body: string) {
	const seen: { url: string; headers: Record<string, string> }[] = [];
	let closed = false;
	const session: BrowserSession = {
		async ensureLoggedIn() {
			return [{ name: "captured", value: "1" }];
		},
		async fetchInSession(url, init) {
			seen.push({ url, headers: init?.headers ?? {} });
			return new Response(body, {
				status: 200,
				headers: { "content-type": "application/rdf+xml" },
			});
		},
		async close() {
			closed = true;
		},
	};
	return { session, seen, isClosed: () => closed };
}

describe("createLiveFetch — a session that serves its own requests", () => {
	it("routes fetches through the session and leaves the browser open for the caller to close", async () => {
		const { session, seen, isClosed } = fakeInSessionBrowser("<rdf/>");
		const live = await createLiveFetch({ session, baseUrl: "https://alm.example" });

		const response = await live.fetchImpl("https://alm.example/rm/resources/TX_1", {
			headers: { "DoorsRP-Request-Type": "private" },
		});

		expect(await response.text()).toBe("<rdf/>");
		expect(seen).toHaveLength(1);
		expect(seen[0]!.url).toBe("https://alm.example/rm/resources/TX_1");
		// The domain headers must survive the hop into the session.
		expect(seen[0]!.headers["doorsrp-request-type"]).toBe("private");
		// Still open: the browser is what holds the session.
		expect(isClosed()).toBe(false);

		await live.close();
		expect(isClosed()).toBe(true);
	});

	it("does NOT replay a persisted jar, so the app can mint its session during login", async () => {
		const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), "live-")), "state.json");
		saveCookieState(statePath, [{ name: "stale", value: "old" }]);
		let loggedIn = false;
		const { session } = fakeInSessionBrowser("<rdf/>");
		const spied: BrowserSession = {
			...session,
			async ensureLoggedIn() {
				loggedIn = true;
				return [];
			},
		};

		await createLiveFetch({ session: spied, baseUrl: "https://alm.example", statePath });

		expect(loggedIn).toBe(true);
	});

	it("its driver carries the domain headers too", async () => {
		const { session, seen } = fakeInSessionBrowser("<rdf/>");
		const live = await createLiveFetch({ session, baseUrl: "https://alm.example" });

		const result = await live.driver({
			url: "https://alm.example/rm/resources/TX_2",
			headers: { "OSLC-Core-Version": "2.0" },
		});

		expect(result.mediaType).toBe("application/rdf+xml");
		expect(seen[0]!.headers["oslc-core-version"]).toBe("2.0");
		await live.close();
	});
});

describe("cookieHeader / cookieFetch", () => {
	it("serializes cookies into a Cookie header value", () => {
		expect(cookieHeader(COOKIES)).toBe("JSESSIONID=abc; CSRFTOKEN=Form");
		expect(cookieHeader([])).toBe("");
	});

	it("wraps a base fetch and adds the Cookie header, preserving caller headers", async () => {
		const base = vi.fn<typeof fetch>(async () => new Response("ok"));
		const fetchImpl = cookieFetch(COOKIES, base);
		await fetchImpl("https://app.example/api/items/42", {
			headers: { Accept: "application/json" },
		});
		const headers = new Headers((base.mock.calls[0]?.[1] as RequestInit).headers);
		expect(headers.get("Cookie")).toBe("JSESSIONID=abc; CSRFTOKEN=Form");
		expect(headers.get("Accept")).toBe("application/json");
	});
});

describe("createCookieFetchDriver", () => {
	it("is a WebFetchDriver whose GET carries the cookies", async () => {
		const base = vi.fn<typeof fetch>(
			async () => new Response("<x/>", { status: 200, headers: { "content-type": "text/xml" } }),
		);
		const driver = createCookieFetchDriver(COOKIES, base);
		const out = await driver({
			url: "https://app.example/api/items/42",
			session: { kind: "authenticated", authenticated: true },
		});
		expect(out.mediaType).toBe("text/xml");
		expect(new Headers((base.mock.calls[0]?.[1] as RequestInit).headers).get("Cookie")).toBe(
			"JSESSIONID=abc; CSRFTOKEN=Form",
		);
	});
});

describe("cookie storageState persistence", () => {
	it("round-trips cookies through a state file", () => {
		const file = tmpFile();
		saveCookieState(file, COOKIES);
		expect(loadCookieState(file)).toEqual(COOKIES);
	});
	it("returns empty for a missing/bad state file (first run)", () => {
		expect(loadCookieState("/no/such/file.json")).toEqual([]);
	});
});

describe("createLiveFetch — login once, reuse the session", () => {
	it("logs in via the browser when no session is persisted, then persists it", async () => {
		const onLogin = vi.fn();
		const file = tmpFile();
		const live = await createLiveFetch({
			session: fakeSession(COOKIES, onLogin),
			baseUrl: "https://app.example",
			statePath: file,
		});
		expect(onLogin).toHaveBeenCalledOnce();
		expect(loadCookieState(file)).toEqual(COOKIES); // persisted for next run
		expect(live.cookies).toEqual(COOKIES);
		// The returned fetchImpl carries the cookies.
		const base = vi.fn<typeof fetch>(async () => new Response("ok"));
		await cookieFetch(live.cookies, base)("https://app.example/x");
		expect(new Headers((base.mock.calls[0]?.[1] as RequestInit).headers).get("Cookie")).toContain(
			"JSESSIONID=abc",
		);
	});

	it("REUSES a persisted session without launching a login", async () => {
		const file = tmpFile();
		saveCookieState(file, COOKIES); // a prior run already logged in
		const onLogin = vi.fn();
		await createLiveFetch({
			session: fakeSession(COOKIES, onLogin),
			baseUrl: "https://app.example",
			statePath: file,
		});
		expect(onLogin).not.toHaveBeenCalled();
	});

	it("its driver + fetchImpl both carry the session cookies", async () => {
		const base = vi.fn<typeof fetch>(async () => new Response("<x/>", { status: 200 }));
		const live = await createLiveFetch({
			session: fakeSession(COOKIES),
			baseUrl: "https://app.example",
			fetchImpl: base,
		});
		await live.driver({
			url: "https://app.example/api/items/42",
			session: { kind: "authenticated", authenticated: true },
		});
		expect(new Headers((base.mock.calls[0]?.[1] as RequestInit).headers).get("Cookie")).toBe(
			"JSESSIONID=abc; CSRFTOKEN=Form",
		);
	});
});
