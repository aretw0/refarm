import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	type GraphNode,
	type NormalisedNode,
	graphNodeToNormalised,
	isoToNanos,
	nanosToIso,
	normalisedToGraphNode,
} from "./index.js";

/**
 * Cross-language convention guard.
 *
 * The Rust host owns the authoritative write path and emits graph nodes via
 * `serde_json::json!` using field names that must match GraphNode (this
 * package). There is no generated/shared type across the WIT boundary — the
 * wire type is `json-ld-node = string` (open by design). These tests pin the
 * convention so it cannot silently drift: if Rust renames a field, or GraphNode
 * does, this fails.
 *
 * Oracle = the actual Rust source. We read the field names Rust writes rather
 * than hard-coding them, so the test tracks the real authoritative writer.
 */
const RUST_SESSION_NODE = join(__dirname, "..", "..", "agent", "src", "session", "pure.rs");

function rustEmittedFields(): Set<string> {
	const src = readFileSync(RUST_SESSION_NODE, "utf8");
	// Match the JSON-LD keys Rust writes inside serde_json::json!({ "key": ... }).
	const fields = new Set<string>();
	for (const m of src.matchAll(/"(@?[a-zA-Z][\w:@-]*)"\s*:/g)) {
		fields.add(m[1]);
	}
	return fields;
}

describe("node graph cross-language convention", () => {
	it("Rust emits the domain fields GraphNode declares (@type/@id/context_id/created_at_ns)", () => {
		const rust = rustEmittedFields();
		// These are the load-bearing GraphNode keys the Rust write path must keep.
		for (const key of ["@type", "@id", "context_id", "created_at_ns"]) {
			expect(rust.has(key), `Rust pure.rs no longer emits "${key}"`).toBe(true);
		}
	});
});

describe("GraphNode ⇄ NormalisedNode adapter", () => {
	const base: GraphNode = {
		"@type": "Session",
		"@id": "urn:agent:runtime-agent",
		title: "A session",
		tags: ["a", "b"],
		priority: 1,
		context_id: "ctx-1",
		created_at_ns: 1_751_500_000_000_000_000,
	};

	it("round-trips domain fields through the transport envelope", () => {
		const normalised = graphNodeToNormalised(base, { sourcePlugin: "agent" });
		expect(normalised["@type"]).toBe("Session");
		expect(normalised["@id"]).toBe(base["@id"]);
		expect(normalised["@context"]).toBe("https://schema.org/");
		expect(normalised["sourcePlugin"]).toBe("agent");
		expect(normalised["context"]).toBe("ctx-1");
		// created_at_ns → ISO
		expect(normalised["createdAt"]).toBe(nanosToIso(base.created_at_ns));

		const back = normalisedToGraphNode(normalised);
		expect(back["@type"]).toBe(base["@type"]);
		expect(back["@id"]).toBe(base["@id"]);
		expect(back.title).toBe(base.title);
		expect(back.tags).toEqual(base.tags);
		expect(back.priority).toBe(base.priority);
		expect(back.context_id).toBe(base.context_id);
		// ISO → created_at_ns (millisecond precision; ns tail is lost, expected)
		expect(back.created_at_ns).toBe(isoToNanos(nanosToIso(base.created_at_ns)));
	});

	it("preserves unknown JSON-LD fields on the open node", () => {
		const open: NormalisedNode = {
			"@context": "https://schema.org/",
			"@type": "Custom",
			"@id": "urn:x:1",
			"createdAt": "2026-07-03T00:00:00.000Z",
			"custom:field": 42,
		};
		// A domain projection drops transport-only fields but the envelope itself
		// keeps arbitrary fields — the extensibility guarantee.
		expect(open["custom:field"]).toBe(42);
		const graph = normalisedToGraphNode(open);
		expect(graph["@type"]).toBe("Custom");
	});

	it("nanos ⇄ iso is stable at millisecond precision", () => {
		const iso = "2026-07-03T12:34:56.789Z";
		expect(nanosToIso(isoToNanos(iso))).toBe(iso);
	});
});
