import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	conditionalValidators,
	decideSync,
	emptyCacheManifest,
	normalizeCacheManifest,
	recordSync,
	syncManifest,
	type CacheManifest,
} from "./cache.js";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("decideSync", () => {
	it("classifies an unseen URI as new", () => {
		const d = decideSync(emptyCacheManifest(), { uri: "a", content: "hello" });
		expect(d.status).toBe("new");
		expect(d.contentSha256).toBe(sha("hello"));
		expect(d.previous).toBeUndefined();
	});

	it("classifies an identical fingerprint as unchanged", () => {
		const { manifest } = recordSync(emptyCacheManifest(), { uri: "a", content: "hello" });
		const d = decideSync(manifest, { uri: "a", content: "hello" });
		expect(d.status).toBe("unchanged");
		expect(d.previous?.contentSha256).toBe(sha("hello"));
	});

	it("classifies a differing fingerprint as changed", () => {
		const { manifest } = recordSync(emptyCacheManifest(), { uri: "a", content: "v1" });
		const d = decideSync(manifest, { uri: "a", content: "v2" });
		expect(d.status).toBe("changed");
	});

	it("accepts a precomputed contentSha256 (e.g. from downloadAttachment)", () => {
		const d = decideSync(emptyCacheManifest(), { uri: "a", contentSha256: "deadbeef" });
		expect(d.contentSha256).toBe("deadbeef");
	});

	it("throws when neither content nor contentSha256 is given", () => {
		expect(() => decideSync(emptyCacheManifest(), { uri: "a" })).toThrow(/content or contentSha256/);
	});
});

describe("recordSync", () => {
	it("does not mutate the input manifest (returns a new one)", () => {
		const base = emptyCacheManifest();
		const { manifest } = recordSync(base, { uri: "a", content: "x" }, "2026-07-13T00:00:00Z");
		expect(base.entries).toEqual({});
		expect(manifest.entries.a?.syncedAt).toBe("2026-07-13T00:00:00Z");
	});

	it("carries etag / lastModified / attributes onto the entry", () => {
		const { manifest } = recordSync(emptyCacheManifest(), {
			uri: "a",
			content: "x",
			etag: 'W/"abc"',
			lastModified: "Mon, 01 Jan 2026 00:00:00 GMT",
			attributes: { folder: "/req" },
		});
		expect(manifest.entries.a?.etag).toBe('W/"abc"');
		expect(manifest.entries.a?.lastModified).toBe("Mon, 01 Jan 2026 00:00:00 GMT");
		expect(manifest.entries.a?.attributes).toEqual({ folder: "/req" });
	});
});

describe("conditionalValidators", () => {
	it("returns the stored validators for a known URI", () => {
		const { manifest } = recordSync(emptyCacheManifest(), { uri: "a", content: "x", etag: "E1" });
		expect(conditionalValidators(manifest, "a")).toEqual({ etag: "E1" });
	});
	it("returns null for an unknown URI or one with no validators", () => {
		const { manifest } = recordSync(emptyCacheManifest(), { uri: "a", content: "x" });
		expect(conditionalValidators(manifest, "a")).toBeNull();
		expect(conditionalValidators(manifest, "missing")).toBeNull();
	});
});

describe("syncManifest — a whole pass with a run summary", () => {
	it("accumulates and reports new/changed/unchanged counts", () => {
		// First pass: two new resources.
		const p1 = syncManifest(emptyCacheManifest(), [
			{ uri: "a", content: "A1" },
			{ uri: "b", content: "B1" },
		]);
		expect(p1.counts).toEqual({ new: 2, changed: 0, unchanged: 0 });

		// Second pass: a unchanged, b changed, c new.
		const p2 = syncManifest(p1.manifest, [
			{ uri: "a", content: "A1" },
			{ uri: "b", content: "B2" },
			{ uri: "c", content: "C1" },
		]);
		expect(p2.counts).toEqual({ new: 1, changed: 1, unchanged: 1 });
		expect(p2.decisions.find((d) => d.uri === "b")?.status).toBe("changed");
	});

	it("is accumulative — a URI absent from a later pass is retained (partial crawl safe)", () => {
		const p1 = syncManifest(emptyCacheManifest(), [
			{ uri: "a", content: "A" },
			{ uri: "b", content: "B" },
		]);
		// A truncated second crawl only saw `a`.
		const p2 = syncManifest(p1.manifest, [{ uri: "a", content: "A" }]);
		expect(Object.keys(p2.manifest.entries).sort()).toEqual(["a", "b"]);
	});
});

describe("normalizeCacheManifest", () => {
	it("returns an empty manifest for undefined/null/garbage (missing file)", () => {
		expect(normalizeCacheManifest(undefined)).toEqual({ version: 1, entries: {} });
		expect(normalizeCacheManifest(null)).toEqual({ version: 1, entries: {} });
		expect(normalizeCacheManifest(42)).toEqual({ version: 1, entries: {} });
	});

	it("keeps well-formed entries and drops malformed ones", () => {
		const loaded = {
			entries: {
				good: { uri: "good", contentSha256: "abc" },
				bad: { uri: "bad" }, // no fingerprint → dropped
			},
		};
		const norm = normalizeCacheManifest(loaded as CacheManifest);
		expect(Object.keys(norm.entries)).toEqual(["good"]);
	});

	it("round-trips a manifest through JSON serialization", () => {
		const { manifest } = recordSync(emptyCacheManifest(), { uri: "a", content: "x", etag: "E" }, "T");
		const round = normalizeCacheManifest(JSON.parse(JSON.stringify(manifest)));
		expect(round.entries.a).toEqual(manifest.entries.a);
	});
});
