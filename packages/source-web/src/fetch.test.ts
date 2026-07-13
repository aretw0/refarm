import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
	ConnectivityError,
	HttpFetchError,
	createHttpFetchDriver,
	createWebSourceProvider,
	isConnectivityError,
	isRecoverableAuthStatus,
	withReauth,
	type WebFetchDriver,
} from "./index.js";

function tmpRoot(): string {
	return mkdtempSync(path.join(os.tmpdir(), "source-web-fetch-"));
}

// An http(s) fixture keyed by the ref's derived identity, so egress lets it through
// (example.invalid is the default allowed host) and the provider has a session template.
const HTTP_URL = "https://example.invalid/rm/resources/TX_1";

describe("fetch driver seam — live fetch vs fixture replay", () => {
	it("uses the injected fetcher's body for an http ref (not the fixture body)", async () => {
		const fetcher = vi.fn<WebFetchDriver>(async (req) => ({
			body: `LIVE:${req.url}`,
			mediaType: "application/rdf+xml",
		}));
		const provider = createWebSourceProvider({
			cacheRoot: tmpRoot(),
			fetcher,
			fetchHeaders: { Accept: "application/rdf+xml", "OSLC-Core-Version": "2.0" },
		});

		const result = await provider.materialize(HTTP_URL);
		const body = readFileSync(path.join(result.location.path, "content.html"), "utf8");

		expect(body).toBe(`LIVE:${HTTP_URL}`);
		expect(fetcher).toHaveBeenCalledOnce();
		// Headers the caller configured reach the driver (the OSLC RDF contract).
		expect(fetcher.mock.calls[0]?.[0].headers).toMatchObject({
			Accept: "application/rdf+xml",
			"OSLC-Core-Version": "2.0",
		});
		// The session template is handed to the driver so it can authenticate.
		expect(fetcher.mock.calls[0]?.[0].session.authenticated).toBe(true);
	});

	it("passes the target's open driver attributes to the fetcher (the OSLC coordinate)", async () => {
		// A driver-specific coordinate (componentURI/streamURI) is opaque to the substrate but
		// must reach the driver so it can build the real OSLC request. It travels config →
		// snapshot → fetch request.
		const fetcher = vi.fn<WebFetchDriver>(async () => ({
			body: "<rdf/>",
			mediaType: "text/plain",
		}));
		const provider = createWebSourceProvider({
			cacheRoot: tmpRoot(),
			fetcher,
			fixtures: {
				efd: {
					identity: "efd",
					url: HTTP_URL,
					mediaType: "text/html",
					body: "",
					session: { kind: "authenticated", authenticated: true },
					pacing: { maxRequestsPerMinute: 12, backoffMs: 500 },
					redaction: { applied: true, fields: [] },
					capturedAt: "2026-06-30T00:00:00.000Z",
					attributes: { componentURI: "urn:comp:1", streamURI: "urn:stream:1" },
				},
			},
		});
		// `web:efd` resolves the efd target and fetches its declared http url with its attributes.
		await provider.materialize("web:efd");
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls[0]?.[0].url).toBe(HTTP_URL);
		expect(fetcher.mock.calls[0]?.[0].attributes).toEqual({
			componentURI: "urn:comp:1",
			streamURI: "urn:stream:1",
		});
	});

	it("does NOT fetch in offline mode — replays the fixture body", async () => {
		const fetcher = vi.fn<WebFetchDriver>(async () => ({ body: "LIVE", mediaType: "text/plain" }));
		const provider = createWebSourceProvider({ cacheRoot: tmpRoot(), fetcher });

		const result = await provider.materialize(HTTP_URL, { offline: true });
		const body = readFileSync(path.join(result.location.path, "content.html"), "utf8");

		expect(fetcher).not.toHaveBeenCalled();
		expect(body).not.toContain("LIVE"); // fixture body, not the wire
	});

	it("a web: ref whose target url is NOT http stays fixture-only (no fetch)", async () => {
		const fetcher = vi.fn<WebFetchDriver>(async () => ({ body: "LIVE", mediaType: "text/plain" }));
		const provider = createWebSourceProvider({
			cacheRoot: tmpRoot(),
			fetcher,
			fixtures: {
				local: {
					identity: "local",
					url: "file:///captured/local.html", // non-http declared url → cannot fetch
					mediaType: "text/html",
					body: "<article>captured</article>",
					session: { kind: "fixture", authenticated: true },
					pacing: { maxRequestsPerMinute: 12, backoffMs: 500 },
					redaction: { applied: true, fields: [] },
					capturedAt: "2026-06-30T00:00:00.000Z",
				},
			},
		});
		await provider.materialize("web:local");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("a web: ref resolves its target's http url and fetches it", async () => {
		const fetcher = vi.fn<WebFetchDriver>(async (req) => ({
			body: `LIVE:${req.url}`,
			mediaType: "application/rdf+xml",
		}));
		const provider = createWebSourceProvider({
			cacheRoot: tmpRoot(),
			fetcher,
			fixtures: {
				efd: {
					identity: "efd",
					url: HTTP_URL,
					mediaType: "text/html",
					body: "",
					session: { kind: "authenticated", authenticated: true },
					pacing: { maxRequestsPerMinute: 12, backoffMs: 500 },
					redaction: { applied: true, fields: [] },
					capturedAt: "2026-06-30T00:00:00.000Z",
				},
			},
		});
		const result = await provider.materialize("web:efd");
		const body = readFileSync(path.join(result.location.path, "content.html"), "utf8");
		expect(body).toBe(`LIVE:${HTTP_URL}`);
	});

	it("without a fetcher, an http ref still replays the fixture (out-of-the-box)", async () => {
		const provider = createWebSourceProvider({ cacheRoot: tmpRoot() });
		const result = await provider.materialize(HTTP_URL);
		const body = readFileSync(path.join(result.location.path, "content.html"), "utf8");
		expect(body).toContain("<article"); // the default fixture html
	});

	it("egress blocks a private host BEFORE the fetcher runs", async () => {
		const fetcher = vi.fn<WebFetchDriver>(async () => ({ body: "LIVE", mediaType: "text/plain" }));
		const provider = createWebSourceProvider({ cacheRoot: tmpRoot(), fetcher });
		await expect(provider.materialize("https://10.0.0.5/rm/resources/TX_1")).rejects.toThrow(
			/EGRESS_DENIED/,
		);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("propagates a driver's HttpFetchError (e.g. 401) rather than silently using the fixture", async () => {
		const fetcher = vi.fn<WebFetchDriver>(async (req) => {
			throw new HttpFetchError(401, req.url);
		});
		const provider = createWebSourceProvider({ cacheRoot: tmpRoot(), fetcher });
		await expect(provider.materialize(HTTP_URL)).rejects.toThrow(HttpFetchError);
	});
});

describe("createHttpFetchDriver + isRecoverableAuthStatus", () => {
	it("GETs with the caller's headers and returns body + content-type", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response("<rdf/>", { status: 200, headers: { "content-type": "application/rdf+xml" } }),
		);
		const driver = createHttpFetchDriver({ fetchImpl: fetchImpl as unknown as typeof fetch });
		const out = await driver({
			url: "https://example.invalid/rm/resources/TX_1",
			session: { kind: "authenticated", authenticated: true },
			headers: { Accept: "application/rdf+xml" },
		});
		expect(out.body).toBe("<rdf/>");
		expect(out.mediaType).toBe("application/rdf+xml");
		expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Accept: "application/rdf+xml" });
	});

	it("maps a non-OK response to HttpFetchError with the status", async () => {
		const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
		const driver = createHttpFetchDriver({ fetchImpl: fetchImpl as unknown as typeof fetch });
		await expect(
			driver({
				url: "https://example.invalid/x",
				session: { kind: "authenticated", authenticated: true },
			}),
		).rejects.toMatchObject({ status: 401 });
	});

	it("treats 401/419 as recoverable, others not", () => {
		expect(isRecoverableAuthStatus(401)).toBe(true);
		expect(isRecoverableAuthStatus(419)).toBe(true);
		expect(isRecoverableAuthStatus(403)).toBe(false);
		expect(isRecoverableAuthStatus(500)).toBe(false);
	});
});

describe("withReauth — recover from a session expiring mid-pull", () => {
	const req = {
		url: "https://alm.example/rm/resources/TX_1",
		session: { kind: "authenticated" as const, authenticated: true, principal: "stale" },
	};

	it("re-authenticates and retries once on a 401, using the fresh session", async () => {
		let calls = 0;
		const inner = vi.fn<WebFetchDriver>(async (r) => {
			calls += 1;
			if (calls === 1) throw new HttpFetchError(401, r.url);
			return { body: `OK as ${r.session.principal}`, mediaType: "text/plain" };
		});
		const reauth = vi.fn(async () => ({
			kind: "authenticated" as const,
			authenticated: true,
			principal: "fresh",
		}));
		const wrapped = withReauth(inner, { reauth });

		const out = await wrapped(req);
		expect(out.body).toBe("OK as fresh"); // retried with the refreshed session
		expect(inner).toHaveBeenCalledTimes(2);
		expect(reauth).toHaveBeenCalledOnce();
	});

	it("gives up after maxRetries and rethrows the 401", async () => {
		const inner = vi.fn<WebFetchDriver>(async (r) => {
			throw new HttpFetchError(401, r.url);
		});
		const reauth = vi.fn(async () => req.session);
		const wrapped = withReauth(inner, { reauth, maxRetries: 2 });

		await expect(wrapped(req)).rejects.toMatchObject({ status: 401 });
		expect(inner).toHaveBeenCalledTimes(3); // initial + 2 retries
		expect(reauth).toHaveBeenCalledTimes(2);
	});

	it("does NOT re-auth a non-recoverable error (e.g. 403)", async () => {
		const inner = vi.fn<WebFetchDriver>(async (r) => {
			throw new HttpFetchError(403, r.url);
		});
		const reauth = vi.fn(async () => req.session);
		const wrapped = withReauth(inner, { reauth });

		await expect(wrapped(req)).rejects.toMatchObject({ status: 403 });
		expect(inner).toHaveBeenCalledOnce();
		expect(reauth).not.toHaveBeenCalled();
	});

	it("does NOT re-auth a connectivity loss (VPN down) — re-login can't reach the server", async () => {
		const inner = vi.fn<WebFetchDriver>(async (r) => {
			throw new ConnectivityError(r.url);
		});
		const reauth = vi.fn(async () => req.session);
		const wrapped = withReauth(inner, { reauth });

		await expect(wrapped(req)).rejects.toBeInstanceOf(ConnectivityError);
		expect(inner).toHaveBeenCalledOnce();
		expect(reauth).not.toHaveBeenCalled();
	});
});

describe("isConnectivityError — VPN/network loss vs application error", () => {
	it("is true for a ConnectivityError", () => {
		expect(isConnectivityError(new ConnectivityError("https://alm/x"))).toBe(true);
	});

	it("is false for an HttpFetchError (the server answered)", () => {
		expect(isConnectivityError(new HttpFetchError(401, "https://alm/x"))).toBe(false);
		expect(isConnectivityError(new HttpFetchError(500, "https://alm/x"))).toBe(false);
	});

	it("recognizes a raw fetch() network failure and its errno cause", () => {
		const fetchFailed = new TypeError("fetch failed");
		(fetchFailed as { cause?: unknown }).cause = Object.assign(new Error("getaddrinfo EAI_AGAIN alm"), {
			code: "EAI_AGAIN",
		});
		expect(isConnectivityError(fetchFailed)).toBe(true);
		expect(isConnectivityError(new Error("connect ECONNREFUSED 10.0.0.5:443"))).toBe(true);
		expect(isConnectivityError(new Error("socket hang up"))).toBe(true);
	});

	it("is false for an unrelated application error", () => {
		expect(isConnectivityError(new Error("bad RDF: unexpected token"))).toBe(false);
	});
});

describe("createHttpFetchDriver — connectivity classification", () => {
	const req = {
		url: "https://example.invalid/rm/resources/TX_1",
		session: { kind: "authenticated" as const, authenticated: true },
	};

	it("wraps a network throw (VPN dropped) into a ConnectivityError carrying the cause", async () => {
		const cause = Object.assign(new Error("fetch failed"), { code: "ENOTFOUND" });
		const fetchImpl = vi.fn(async () => {
			throw cause;
		});
		const driver = createHttpFetchDriver({ fetchImpl: fetchImpl as unknown as typeof fetch });
		await expect(driver(req)).rejects.toBeInstanceOf(ConnectivityError);
		await expect(driver(req)).rejects.toMatchObject({ url: req.url, cause });
	});

	it("does NOT reclassify a 401 as connectivity (the server did answer)", async () => {
		const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
		const driver = createHttpFetchDriver({ fetchImpl: fetchImpl as unknown as typeof fetch });
		await expect(driver(req)).rejects.toBeInstanceOf(HttpFetchError);
	});
});
