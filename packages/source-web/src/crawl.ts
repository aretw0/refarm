import type { WebFetchDriver, WebFetchRequest, WebFetchResult, WebSourceSessionEvidence } from "./types.js";

/**
 * The generic CRAWL engine — BFS a source starting from seed URL(s), following links a
 * domain extractor yields, until a depth/page budget is hit. This is the machine an
 * operational scraper needs to pull a whole PROJECT (a folder tree, an artifact graph),
 * not just one resource: the substrate ships the traversal (queue, seen-set, caps, pacing,
 * re-auth mid-crawl); the consumer brings the DOMAIN link extractor (which URLs come next
 * from a fetched body) and the fetch driver.
 *
 * Everything domain-specific is injected data: `extractLinks` (an OSLC `/rm/links` walker, a
 * folder-tree BFS, an HTML anchor scraper) decides what to enqueue. The engine never parses
 * a body — it only fetches, dedupes, paces, and hands each body back.
 */

/** One fetched page in a crawl: where it came from + what came back + how deep it was. */
export interface CrawledPage {
	url: string;
	body: string;
	mediaType: string;
	/** BFS depth from the seed (seed = 0). */
	depth: number;
}

/** What a domain extractor returns for one fetched page: the next URLs to crawl. Each may
 * carry its own `attributes`/`headers` (e.g. an OSLC page yields child folder URLs with a
 * Configuration-Context header). A returned URL already seen is ignored by the engine. */
export interface CrawlLink {
	url: string;
	headers?: Record<string, string>;
	attributes?: Record<string, string>;
}

/** Extract the next links to crawl from a fetched page. Domain-specific (the consumer's OSLC
 * link walker / HTML anchor scraper); PURE is not required (it only reads the page). Returning
 * `[]` ends that branch. */
export type CrawlLinkExtractor = (
	page: CrawledPage,
) => CrawlLink[] | Promise<CrawlLink[]>;

export interface CrawlSeed {
	url: string;
	headers?: Record<string, string>;
	attributes?: Record<string, string>;
}

export interface CrawlOptions {
	/** The session to fetch under (the authenticated evidence from login-garantido). */
	session: WebSourceSessionEvidence;
	/** Extract the next links from each fetched page — the domain's traversal, as a function. */
	extractLinks: CrawlLinkExtractor;
	/** Max BFS depth from a seed (seed = 0). Default 3. A depth cap bounds an unbounded tree. */
	maxDepth?: number;
	/** Max total pages fetched across the whole crawl. Default 500. A hard stop against a
	 * runaway crawl; when hit, the crawl ends and `truncated` is true. */
	maxPages?: number;
	/** Await this many ms between fetches (polite pacing / rate-limit friendliness). Default 0. */
	pacingMs?: number;
	/** Called after each page is fetched (progress/telemetry). Best-effort. */
	onPage?: (page: CrawledPage) => void;
	/** Sleep impl (injected so tests don't actually wait). Default setTimeout. */
	sleep?: (ms: number) => Promise<void>;
}

export interface CrawlResult {
	pages: CrawledPage[];
	/** True if the crawl stopped at `maxPages` with links still unvisited (coverage is partial). */
	truncated: boolean;
	/** How many distinct URLs were enqueued (seen), for a coverage report. */
	seen: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crawl from `seeds`, following `extractLinks`, using `fetcher` (typically wrapped in
 * `withReauth` so a mid-crawl 401 re-authenticates). BFS with a seen-set (no URL fetched
 * twice) and depth/page caps. Returns every fetched page for the caller to parse.
 *
 * The engine is transport-agnostic: `fetcher` is any WebFetchDriver, so a fixture drives it
 * offline in a test and a browser-cookie driver scrapes a real VPN system unchanged.
 */
export async function crawlSource(
	fetcher: WebFetchDriver,
	seeds: readonly CrawlSeed[],
	options: CrawlOptions,
): Promise<CrawlResult> {
	const maxDepth = options.maxDepth ?? 3;
	const maxPages = options.maxPages ?? 500;
	const pacingMs = options.pacingMs ?? 0;
	const sleep = options.sleep ?? defaultSleep;

	const seen = new Set<string>();
	const queue: Array<CrawlSeed & { depth: number }> = [];
	for (const seed of seeds) {
		if (seen.has(seed.url)) continue;
		seen.add(seed.url);
		queue.push({ ...seed, depth: 0 });
	}

	const pages: CrawledPage[] = [];
	let truncated = false;
	let first = true;

	while (queue.length > 0) {
		if (pages.length >= maxPages) {
			// There is still work queued but the budget is spent → partial coverage.
			truncated = queue.length > 0;
			break;
		}
		const item = queue.shift()!;

		if (pacingMs > 0 && !first) await sleep(pacingMs);
		first = false;

		const request: WebFetchRequest = {
			url: item.url,
			session: options.session,
			...(item.headers ? { headers: item.headers } : {}),
			...(item.attributes ? { attributes: item.attributes } : {}),
		};
		const result: WebFetchResult = await fetcher(request);
		const page: CrawledPage = {
			url: item.url,
			body: result.body,
			mediaType: result.mediaType,
			depth: item.depth,
		};
		pages.push(page);
		options.onPage?.(page);

		// Only descend if we're under the depth cap.
		if (item.depth >= maxDepth) continue;
		const links = await options.extractLinks(page);
		for (const link of links) {
			if (seen.has(link.url)) continue; // dedupe — never fetch a URL twice
			seen.add(link.url);
			queue.push({ ...link, depth: item.depth + 1 });
		}
	}

	return { pages, truncated, seen: seen.size };
}
