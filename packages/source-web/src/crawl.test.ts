import { describe, expect, it, vi } from "vitest";

import { crawlSource, type CrawlLinkExtractor } from "./crawl.js";
import { HttpFetchError, withReauth } from "./fetch.js";
import type { WebFetchDriver, WebSourceSessionEvidence } from "./types.js";

const session: WebSourceSessionEvidence = { kind: "authenticated", authenticated: true };

/** A fixture site: url → body. The driver replays it; the extractor reads `next:a,b` markers. */
function fixtureDriver(site: Record<string, string>): WebFetchDriver {
	return async (req) => {
		const body = site[req.url];
		if (body === undefined) throw new HttpFetchError(404, req.url);
		return { body, mediaType: "text/plain" };
	};
}

/** Extract links from a body of the form `next:urlA,urlB`. */
const nextExtractor: CrawlLinkExtractor = (page) => {
	const m = page.body.match(/next:([^\n]+)/);
	if (!m) return [];
	return m[1]!.split(",").map((url) => ({ url: url.trim() }));
};

describe("crawlSource — BFS traversal", () => {
	it("crawls a tree from the seed, following extracted links", async () => {
		const site = {
			"/root": "next:/a,/b",
			"/a": "next:/a1",
			"/b": "leaf",
			"/a1": "leaf",
		};
		const result = await crawlSource(fixtureDriver(site), [{ url: "/root" }], {
			session,
			extractLinks: nextExtractor,
		});
		expect(result.pages.map((p) => p.url).sort()).toEqual(["/a", "/a1", "/b", "/root"]);
		expect(result.truncated).toBe(false);
	});

	it("dedupes — a URL reachable by two paths is fetched once", async () => {
		const site = { "/root": "next:/a,/b", "/a": "next:/shared", "/b": "next:/shared", "/shared": "leaf" };
		const driver = vi.fn(fixtureDriver(site));
		const result = await crawlSource(driver, [{ url: "/root" }], { session, extractLinks: nextExtractor });
		const sharedFetches = driver.mock.calls.filter((c) => c[0].url === "/shared").length;
		expect(sharedFetches).toBe(1);
		expect(result.pages).toHaveLength(4);
	});

	it("respects maxDepth (does not descend past the cap)", async () => {
		const site = { "/0": "next:/1", "/1": "next:/2", "/2": "next:/3", "/3": "leaf" };
		const result = await crawlSource(fixtureDriver(site), [{ url: "/0" }], {
			session,
			extractLinks: nextExtractor,
			maxDepth: 1,
		});
		// depth 0 (/0) + depth 1 (/1); /2 (depth 2) is never enqueued.
		expect(result.pages.map((p) => p.url)).toEqual(["/0", "/1"]);
	});

	it("respects maxPages and reports truncated", async () => {
		const site = { "/0": "next:/1,/2,/3", "/1": "leaf", "/2": "leaf", "/3": "leaf" };
		const result = await crawlSource(fixtureDriver(site), [{ url: "/0" }], {
			session,
			extractLinks: nextExtractor,
			maxPages: 2,
		});
		expect(result.pages).toHaveLength(2);
		expect(result.truncated).toBe(true);
	});

	it("paces between fetches when pacingMs is set", async () => {
		const site = { "/0": "next:/1", "/1": "leaf" };
		const sleep = vi.fn(async () => {});
		await crawlSource(fixtureDriver(site), [{ url: "/0" }], {
			session,
			extractLinks: nextExtractor,
			pacingMs: 50,
			sleep,
		});
		// One sleep between the two fetches (not before the first).
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(sleep).toHaveBeenCalledWith(50);
	});

	it("carries per-link headers/attributes into the fetch request", async () => {
		const seen: Array<Record<string, unknown>> = [];
		const driver: WebFetchDriver = async (req) => {
			seen.push({ url: req.url, headers: req.headers, attributes: req.attributes });
			return { body: req.url === "/root" ? "" : "leaf", mediaType: "text/plain" };
		};
		const extract: CrawlLinkExtractor = (page) =>
			page.url === "/root" ? [{ url: "/child", headers: { Accept: "x" }, attributes: { ctx: "s1" } }] : [];
		await crawlSource(driver, [{ url: "/root" }], { session, extractLinks: extract });
		const child = seen.find((s) => s.url === "/child");
		expect(child?.headers).toEqual({ Accept: "x" });
		expect(child?.attributes).toEqual({ ctx: "s1" });
	});
});

describe("crawlSource + withReauth — re-auth mid-crawl", () => {
	it("recovers from a 401 on a page by re-authenticating and retrying", async () => {
		let failedOnce = false;
		const raw: WebFetchDriver = async (req) => {
			if (req.url === "/b" && !failedOnce) {
				failedOnce = true;
				throw new HttpFetchError(401, req.url); // session expired mid-crawl
			}
			const site: Record<string, string> = { "/root": "next:/a,/b", "/a": "leaf", "/b": "leaf" };
			return { body: site[req.url] ?? "leaf", mediaType: "text/plain" };
		};
		const reauth = vi.fn(async () => session); // fresh session
		const fetcher = withReauth(raw, { reauth });

		const result = await crawlSource(fetcher, [{ url: "/root" }], { session, extractLinks: nextExtractor });
		expect(reauth).toHaveBeenCalledTimes(1);
		expect(result.pages.map((p) => p.url).sort()).toEqual(["/a", "/b", "/root"]);
	});
});
