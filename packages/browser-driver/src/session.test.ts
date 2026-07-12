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
