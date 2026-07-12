import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
	HttpFetchError,
	createHttpFetchDriver,
	createWebSourceProvider,
	isRecoverableAuthStatus,
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

	it("does NOT fetch in offline mode — replays the fixture body", async () => {
		const fetcher = vi.fn<WebFetchDriver>(async () => ({ body: "LIVE", mediaType: "text/plain" }));
		const provider = createWebSourceProvider({ cacheRoot: tmpRoot(), fetcher });

		const result = await provider.materialize(HTTP_URL, { offline: true });
		const body = readFileSync(path.join(result.location.path, "content.html"), "utf8");

		expect(fetcher).not.toHaveBeenCalled();
		expect(body).not.toContain("LIVE"); // fixture body, not the wire
	});

	it("does NOT fetch a web: ref (non-http) — that's a fixture identity", async () => {
		const fetcher = vi.fn<WebFetchDriver>(async () => ({ body: "LIVE", mediaType: "text/plain" }));
		const provider = createWebSourceProvider({ cacheRoot: tmpRoot(), fetcher });

		await provider.materialize("web:requirements-fixture");
		expect(fetcher).not.toHaveBeenCalled();
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
