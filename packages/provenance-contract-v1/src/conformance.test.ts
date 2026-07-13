import { describe, expect, it } from "vitest";

import { runProvenanceV1Conformance } from "./conformance.js";
import { readProvenance, stampProvenance, verifyProvenance } from "./provenance.js";
import { PROVENANCE_FIELD, type NoteProvenance } from "./types.js";

describe("provenance:v1 conformance", () => {
	it("passes the round-trip + check suite", () => {
		const result = runProvenanceV1Conformance();
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("stamp/read round-trip", () => {
	it("stamps under the reserved key and keeps existing fields", () => {
		const out = stampProvenance({ title: "Nota" }, { channel: "inbox", sourceFile: "a.md" });
		expect(out.title).toBe("Nota");
		expect(out[PROVENANCE_FIELD]).toEqual({ channel: "inbox", sourceFile: "a.md" });
		expect(readProvenance(out)?.channel).toBe("inbox");
	});

	it("drops undefined fields (no null sentinels — the rcdc5 link_origem:null smell)", () => {
		const out = stampProvenance({}, { channel: "inbox", originLink: undefined, sourcePath: undefined });
		expect(out[PROVENANCE_FIELD]).toEqual({ channel: "inbox" });
	});

	it("reads null when provenance is absent or has no channel", () => {
		expect(readProvenance({})).toBeNull();
		expect(readProvenance({ [PROVENANCE_FIELD]: { sourceFile: "a" } })).toBeNull();
	});
});

describe("verifyProvenance", () => {
	const base: NoteProvenance = { channel: "web-scrape" };

	it("a channel-only note is valid (it knows how it arrived)", () => {
		expect(verifyProvenance(base).valid).toBe(true);
	});

	it("requires the channel", () => {
		const r = verifyProvenance(readProvenance({}));
		expect(r.valid).toBe(false);
		expect(r.checks["has-channel"]?.ok).toBe(false);
	});

	it("validates the sha256 shape only when present", () => {
		expect(verifyProvenance({ ...base, contentSha256: "a".repeat(64) }).valid).toBe(true);
		const bad = verifyProvenance({ ...base, contentSha256: "xyz" });
		expect(bad.valid).toBe(false);
		expect(bad.checks["sha256-shape"]?.ok).toBe(false);
	});

	it("validates collectedAt shape only when present", () => {
		expect(verifyProvenance({ ...base, collectedAt: "2026-01-01T00:00:00.000Z" }).valid).toBe(true);
		expect(verifyProvenance({ ...base, collectedAt: "não é data" }).valid).toBe(false);
	});

	it("records not-empty-origin as a soft check (channel-only stays valid)", () => {
		const r = verifyProvenance(base);
		expect(r.checks["not-empty-origin"]?.ok).toBe(false);
		expect(r.valid).toBe(true); // soft — does not sink validity
	});
});
