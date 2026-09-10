import {
	createWebSourceProvider,
	type WebSourceEgressPolicy,
	type WebSourceProvider,
	type WebSourceSessionEvidence,
	type WebSourceSnapshot,
} from "@refarm.dev/source-web";

import { createOslcFetchDriver } from "./oslc.js";

/**
 * A full `source:v1` provider for OSLC / IBM Jazz endpoints — composed, not reimplemented. It wires
 * the generic OSLC fetch driver (this package) into `source-web`'s `createWebSourceProvider`, which
 * already owns the whole `source:v1` surface (resolve / materialize / status / refresh / discover)
 * plus session, egress allowlisting, caching, redaction and provenance. Each OSLC target becomes a
 * `web:<identity>` ref carrying its OSLC driver attributes (`streamURI` / `componentURI` / …), so the
 * driver reads the Configuration-Context per target.
 *
 * SOVEREIGN BOUNDARY: everything vendor-specific is passed IN by the consumer and stays downstream —
 * the authenticated `fetchImpl` (bound to the consumer's SSO/session, e.g. a SerproID QR/token flow),
 * the concrete project/stream URLs, and the egress host allowlist. This package contributes only the
 * generic OSLC protocol wiring. The `session` here is neutral evidence (`WebSourceSessionEvidence`);
 * how it was obtained (which SSO, which credential store) is the consumer's product concern.
 */

/** One OSLC source the provider offers to materialize. */
export interface OslcSourceTarget {
	/** Identity → becomes the `web:<identity>` ref passed to materialize/status. */
	identity: string;
	/** The OSLC resource/query URL to GET (a project-area query capability, a folder, an artifact). */
	url: string;
	/** The OSLC Configuration-Context (stream/baseline URI), carried per target. */
	streamURI?: string;
	/** Other OSLC driver attributes the fetch driver may need (componentURI, folderId, projectArea…). */
	attributes?: Record<string, string>;
	/** A human-readable label for `discover()`. */
	label?: string;
}

export interface OslcSourceProviderOptions {
	/** The OSLC targets this provider offers — its `discover()` catalog. */
	targets: OslcSourceTarget[];
	pluginId?: string;
	cacheRoot?: string;
	/** Neutral session evidence to attach to pulls (the consumer builds it from its own auth). */
	session?: WebSourceSessionEvidence;
	/** The authenticated live fetch. Absent = offline (the substrate replays the cached snapshot). */
	fetchImpl?: typeof fetch;
	/** Egress host allowlist (the consumer's ALM host(s)). Defaults deny non-allowlisted hosts. */
	egress?: Partial<WebSourceEgressPolicy>;
	now?: () => string;
}

const DEFAULT_NOW = "2026-06-30T00:00:00.000Z";

function targetToSnapshot(target: OslcSourceTarget, session: WebSourceSessionEvidence, capturedAt: string): WebSourceSnapshot {
	const attributes = {
		...(target.streamURI ? { streamURI: target.streamURI } : {}),
		...(target.attributes ?? {}),
	};
	return {
		identity: target.identity,
		url: target.url,
		mediaType: "application/rdf+xml",
		body: "", // filled by the live fetch; an empty placeholder for offline replay
		session,
		pacing: { maxRequestsPerMinute: 12, backoffMs: 500, userAgent: "refarm-source-oslc" },
		redaction: { applied: true, fields: ["cookie", "authorization", "set-cookie"] },
		capturedAt,
		...(Object.keys(attributes).length > 0 ? { attributes } : {}),
	};
}

/**
 * Build a `source:v1` provider for a set of OSLC targets. Materializing a `web:<identity>` ref GETs
 * the target's URL through the OSLC driver (RDF Accept + per-target Configuration-Context; a 401 stays
 * a recoverable re-auth signal) and snapshots it via the substrate. Compose with this package's
 * `createOslcCrawlExtractor` to walk a whole project's folder → artifact graph.
 */
export function createOslcSourceProvider(options: OslcSourceProviderOptions): WebSourceProvider {
	const now = options.now ?? (() => DEFAULT_NOW);
	const session: WebSourceSessionEvidence = options.session ?? {
		kind: options.fetchImpl ? "authenticated" : "fixture",
		authenticated: true,
	};
	const capturedAt = now();
	const fixtures: Record<string, WebSourceSnapshot> = {};
	for (const target of options.targets) {
		fixtures[target.identity] = targetToSnapshot(target, session, capturedAt);
	}

	return createWebSourceProvider({
		pluginId: options.pluginId ?? "@refarm.dev/source-oslc",
		...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
		fixtures,
		...(options.egress ? { egress: options.egress } : {}),
		now,
		// The OSLC dialect: the driver applies RDF Accept + Configuration-Context (from each target's
		// `streamURI` attribute) and turns a non-OK response into an HttpFetchError. Absent fetchImpl =
		// offline replay of the cached snapshot.
		...(options.fetchImpl ? { fetcher: createOslcFetchDriver({ fetchImpl: options.fetchImpl }) } : {}),
	});
}
