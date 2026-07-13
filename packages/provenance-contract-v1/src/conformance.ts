import { readProvenance, stampProvenance, verifyProvenance } from "./provenance.js";
import { PROVENANCE_FIELD, type NoteProvenance, type ProvenanceConformanceResult } from "./types.js";

/**
 * Conformance for provenance:v1 — the round-trip and check invariants any provenance
 * carrier relies on: a stamped provenance reads back equal, undefined fields drop, the
 * required channel is enforced, and shape checks fire only on present fields.
 */
export function runProvenanceV1Conformance(): ProvenanceConformanceResult {
	const failures: string[] = [];
	const check = (name: string, ok: boolean) => {
		if (!ok) failures.push(name);
	};

	const full: NoteProvenance = {
		channel: "web-scrape",
		sourceFile: "demanda-42.html",
		sourcePath: "raw/demanda-42.html",
		originLink: "https://alm.example/artifact/42",
		collectedAt: "2026-01-01T00:00:00.000Z",
		contentSha256: "a".repeat(64),
		license: "verificar",
		privacy: "private-until-published",
	};

	// Round-trip: stamp → read back equal.
	const stamped = stampProvenance({ title: "x" }, full);
	check("stamp keeps existing fields", stamped.title === "x");
	check("stamp writes under the reserved key", Boolean(stamped[PROVENANCE_FIELD]));
	const read = readProvenance(stamped);
	check("read returns the provenance", read !== null);
	check("round-trip preserves channel", read?.channel === "web-scrape");
	check("round-trip preserves origin link", read?.originLink === "https://alm.example/artifact/42");

	// Undefined fields drop (no null sentinels).
	const sparse = stampProvenance({}, { channel: "inbox", originLink: undefined });
	const sparseObj = sparse[PROVENANCE_FIELD] as Record<string, unknown>;
	check("undefined fields are dropped", !("originLink" in sparseObj));

	// Verify: a channel-only note is valid.
	check("channel-only provenance is valid", verifyProvenance({ channel: "inbox" }).valid);
	// Missing channel is invalid.
	check("no channel is invalid", !verifyProvenance(readProvenance({})).valid);
	// A bad sha256 shape fails.
	check(
		"malformed sha256 fails the shape check",
		!verifyProvenance({ channel: "x", contentSha256: "nothex" }).valid,
	);
	// A bad collectedAt fails.
	check(
		"malformed collectedAt fails",
		!verifyProvenance({ channel: "x", collectedAt: "yesterday" }).valid,
	);
	// The full provenance verifies.
	check("full provenance verifies", verifyProvenance(full).valid);

	const total = 12;
	return { pass: failures.length === 0, total, failed: failures.length, failures };
}
