import { describe, expect, it } from "vitest";

import { unfoldSessionContextFold, type SessionContextFold } from "./context-folding.js";
import type { SessionEntry } from "./types.js";

/**
 * CROSS-LANGUAGE ROUND-TRIP: the reversible fold is only useful if a fold EMITTED BY
 * THE RUST GUEST (packages/agent `context_fold.rs`) can be UNFOLDED by this TS contract,
 * reconstructing the original turns with no digest mismatch. The digest-conformance test
 * on the Rust side proves the hash matches; this proves the whole record round-trips.
 *
 * The `RUST_EMITTED_FOLD` below is a verbatim capture of what
 * `build_session_context_fold` produces (pinned on the Rust side by
 * `emitted_fold_matches_pinned_ts_roundtrip_fixture`). If either side changes the shape,
 * one of the two tests fails — the drift is felt, not silent.
 *
 * The entries carry non-ASCII content ("olá mundo", "resposta ação👍" — accent + astral
 * emoji) precisely because that is where a byte-vs-UTF-16 digest bug would surface: if
 * the Rust digest were wrong for these, `digest_mismatches` here would be non-empty.
 */
const RUST_EMITTED_FOLD: SessionContextFold = {
	"@id": "urn:sovereign:session-context-fold:v1:1bc6557738034c81:62dc47ffa6e7e9d6",
	"@type": "SessionContextFold",
	created_at_ns: 999,
	digest: { algorithm: "refarm-stable-fnv1a64-v1", value: "62dc47ffa6e7e9d6" },
	folded_entry_refs: [
		{
			content_digest: { algorithm: "refarm-stable-fnv1a64-v1", value: "133a5f62f36b46b4" },
			entry_id: "urn:e1",
			kind: "user",
			parent_entry_id: null,
			timestamp_ns: 100,
		},
		{
			content_digest: { algorithm: "refarm-stable-fnv1a64-v1", value: "9ccba8cadcf2e4b2" },
			entry_id: "urn:e2",
			kind: "agent",
			parent_entry_id: "urn:e1",
			timestamp_ns: 200,
		},
	],
	protected_tail_entry_ids: ["urn:e3"],
	range: { entry_count: 2, from_entry_id: "urn:e1", to_entry_id: "urn:e2" },
	schema: "refarm.session-context-fold.v1",
	session_id: "sess-1",
	summary: "digest",
};

/** The original entries the fold refers to (also captured from the Rust fixture). */
const ORIGINAL_ENTRIES: SessionEntry[] = [
	{
		"@type": "SessionEntry",
		"@id": "urn:e1",
		content: "olá mundo",
		kind: "user",
		parent_entry_id: null,
		session_id: "sess-1",
		timestamp_ns: 100,
	},
	{
		"@type": "SessionEntry",
		"@id": "urn:e2",
		content: "resposta ação👍",
		kind: "agent",
		parent_entry_id: "urn:e1",
		session_id: "sess-1",
		timestamp_ns: 200,
	},
];

describe("Rust→TS context-fold round-trip", () => {
	it("unfolds a Rust-emitted fold, reconstructing the turns with no digest mismatch", () => {
		const result = unfoldSessionContextFold(RUST_EMITTED_FOLD, ORIGINAL_ENTRIES);
		// The folded turns are reconstructed, in folded-reference order.
		expect(result.entries.map((e) => e["@id"])).toEqual(["urn:e1", "urn:e2"]);
		expect(result.entries.map((e) => e.content)).toEqual(["olá mundo", "resposta ação👍"]);
		// The whole point: the Rust digest matches the TS re-computation → nothing torn.
		expect(result.missing_entry_ids).toEqual([]);
		expect(result.digest_mismatches).toEqual([]);
	});

	it("reports a digest mismatch if a reconstructed turn's content was tampered", () => {
		// Negative control: prove the digest actually guards integrity — a changed
		// content byte MUST surface as a mismatch (so a silent corruption can't pass).
		const tampered: SessionEntry[] = [
			{ ...ORIGINAL_ENTRIES[0]!, content: "olá mundo TAMPERED" },
			ORIGINAL_ENTRIES[1]!,
		];
		const result = unfoldSessionContextFold(RUST_EMITTED_FOLD, tampered);
		expect(result.digest_mismatches.map((m) => m.entry_id)).toEqual(["urn:e1"]);
	});

	it("reports a missing entry when a folded turn is absent from the store", () => {
		const result = unfoldSessionContextFold(RUST_EMITTED_FOLD, [ORIGINAL_ENTRIES[1]!]);
		expect(result.missing_entry_ids).toEqual(["urn:e1"]);
		expect(result.entries.map((e) => e["@id"])).toEqual(["urn:e2"]);
	});
});
