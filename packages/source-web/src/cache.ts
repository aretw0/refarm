import { createHash } from "node:crypto";

/**
 * The generic ACCUMULATIVE CACHE + INCREMENTAL SYNC block — the machine that lets a scraper
 * run against a whole project repeatedly WITHOUT re-doing the work each time: it remembers, per
 * stable resource URI, a content fingerprint (and any validators the source gave), so a second
 * pass classifies each resource as `unchanged | changed | new` and the caller only re-processes
 * what moved.
 *
 * This is a deliberate step beyond the operational scraper it's modeled on: that one accumulates
 * by URI but decides "changed" from a stored `modified` TIMESTAMP string-inequality and throws
 * its attachment SHA-256 away for decisions. Here the fingerprint is a content SHA-256 (always
 * available, never lies), with the source's own validators (etag / lastModified) carried
 * ALONGSIDE so the caller can also issue a conditional fetch (If-None-Match / If-Modified-Since →
 * 304) and skip the download entirely. The three signals are checked in order of trust.
 *
 * The substrate ships the MANIFEST model (load → merge-by-URI → decide → stamp) and the pure
 * decision core; it is filesystem-agnostic — the caller reads/writes the manifest JSON wherever
 * it persists (an fs file, a ledger, OPFS). The manifest is a plain serializable object.
 */

/** One resource's record in the accumulative manifest: enough to decide whether a later fetch
 * changed it, plus the source's own validators for a conditional request. Keyed by `uri`. */
export interface CacheEntry {
	/** The stable resource identity (an OSLC artifact URI, a canonical URL). The manifest key. */
	uri: string;
	/** SHA-256 hex of the fetched content — the fingerprint that never lies. */
	contentSha256: string;
	/** The source's ETag, if it returned one — lets the next pass send If-None-Match. */
	etag?: string;
	/** The source's Last-Modified (as the source gave it), for If-Modified-Since. */
	lastModified?: string;
	/** When this entry was last synced (ISO). Injected by the caller (no ambient clock here). */
	syncedAt?: string;
	/** Opaque per-resource metadata the caller wants to carry across runs (folder path, title). */
	attributes?: Record<string, string>;
}

/** The accumulative manifest: version + a URI→entry map. Serializable; the caller persists it. */
export interface CacheManifest {
	version: 1;
	entries: Record<string, CacheEntry>;
}

/** The freshly-observed state of a resource in the current pass, to compare against the manifest.
 * The caller supplies the content (bytes or string → hashed here) OR a precomputed sha256, plus
 * any validators the source returned this pass. */
export interface ObservedResource {
	uri: string;
	/** The fetched content — hashed to a fingerprint. Provide this OR `contentSha256`. */
	content?: string | Uint8Array;
	/** A precomputed fingerprint (e.g. from downloadAttachment's hash). Provide this OR `content`. */
	contentSha256?: string;
	etag?: string;
	lastModified?: string;
	attributes?: Record<string, string>;
}

/** How a resource compares to the manifest. `new` = never seen; `changed` = fingerprint differs;
 * `unchanged` = same fingerprint. */
export type SyncStatus = "new" | "changed" | "unchanged";

export interface SyncDecision {
	uri: string;
	status: SyncStatus;
	contentSha256: string;
	/** The prior entry, if any — for a caller that wants the delta (old attributes vs new). */
	previous?: CacheEntry;
}

const EMPTY_MANIFEST: CacheManifest = { version: 1, entries: {} };

/** Start an empty manifest (or normalize a loaded one that may be missing fields). */
export function emptyCacheManifest(): CacheManifest {
	return { version: 1, entries: {} };
}

/** Coerce a loaded-from-disk value into a valid manifest — tolerant of a missing file (undefined),
 * a legacy shape, or a null. Never throws; an unrecognizable input yields an empty manifest. */
export function normalizeCacheManifest(loaded: unknown): CacheManifest {
	if (!loaded || typeof loaded !== "object") return emptyCacheManifest();
	const entries = (loaded as { entries?: unknown }).entries;
	if (!entries || typeof entries !== "object") return emptyCacheManifest();
	const out: CacheManifest = { version: 1, entries: {} };
	for (const [uri, value] of Object.entries(entries as Record<string, unknown>)) {
		if (value && typeof value === "object" && typeof (value as CacheEntry).contentSha256 === "string") {
			out.entries[uri] = { ...(value as CacheEntry), uri };
		}
	}
	return out;
}

function fingerprint(observed: ObservedResource): string {
	if (observed.contentSha256) return observed.contentSha256;
	if (observed.content !== undefined) return createHash("sha256").update(observed.content).digest("hex");
	throw new Error(`ObservedResource ${observed.uri}: provide content or contentSha256`);
}

/** Decide how one observed resource compares to the manifest — PURE (given a precomputed
 * fingerprint or content to hash). Does not mutate the manifest. */
export function decideSync(manifest: CacheManifest, observed: ObservedResource): SyncDecision {
	const contentSha256 = fingerprint(observed);
	const previous = manifest.entries[observed.uri];
	if (!previous) return { uri: observed.uri, status: "new", contentSha256 };
	const status: SyncStatus = previous.contentSha256 === contentSha256 ? "unchanged" : "changed";
	return { uri: observed.uri, status, contentSha256, previous };
}

/** Whether a conditional fetch can be attempted for this URI — i.e. the manifest holds an ETag
 * or Last-Modified the caller can send (If-None-Match / If-Modified-Since) to get a cheap 304
 * BEFORE downloading the body. Returns the validators to send, or null if none are known. */
export function conditionalValidators(
	manifest: CacheManifest,
	uri: string,
): { etag?: string; lastModified?: string } | null {
	const entry = manifest.entries[uri];
	if (!entry) return null;
	const out: { etag?: string; lastModified?: string } = {};
	if (entry.etag) out.etag = entry.etag;
	if (entry.lastModified) out.lastModified = entry.lastModified;
	return out.etag || out.lastModified ? out : null;
}

/** Merge one observed resource into the manifest, returning a NEW manifest (never mutates the
 * input) and the decision. `syncedAt` is injected (no ambient clock). Accumulative: a URI absent
 * from this pass is retained (a partial/truncated crawl must not evict prior coverage). */
export function recordSync(
	manifest: CacheManifest,
	observed: ObservedResource,
	syncedAt?: string,
): { manifest: CacheManifest; decision: SyncDecision } {
	const decision = decideSync(manifest, observed);
	const entry: CacheEntry = {
		uri: observed.uri,
		contentSha256: decision.contentSha256,
		...(observed.etag !== undefined ? { etag: observed.etag } : {}),
		...(observed.lastModified !== undefined ? { lastModified: observed.lastModified } : {}),
		...(syncedAt !== undefined ? { syncedAt } : {}),
		...(observed.attributes !== undefined ? { attributes: observed.attributes } : {}),
	};
	const next: CacheManifest = { version: 1, entries: { ...manifest.entries, [observed.uri]: entry } };
	return { manifest: next, decision };
}

export interface SyncReport {
	manifest: CacheManifest;
	decisions: SyncDecision[];
	counts: { new: number; changed: number; unchanged: number };
}

/** Fold a whole pass's observations into the manifest at once, returning the updated manifest,
 * every decision, and an aggregate count — the run summary the operational scraper never had.
 * Accumulative: URIs seen in prior runs but absent here are retained. */
export function syncManifest(
	manifest: CacheManifest,
	observations: readonly ObservedResource[],
	syncedAt?: string,
): SyncReport {
	let current = manifest;
	const decisions: SyncDecision[] = [];
	const counts = { new: 0, changed: 0, unchanged: 0 };
	for (const observed of observations) {
		const { manifest: next, decision } = recordSync(current, observed, syncedAt);
		current = next;
		decisions.push(decision);
		counts[decision.status] += 1;
	}
	return { manifest: current, decisions, counts };
}
