import { normalisedToGraphNode } from "@refarm.dev/node-contract-v1";
import {
	CURRENT_RECORD_SCHEMA_VERSION,
	type KnowledgeRecord,
} from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import { DEFAULT_VAULT_RECORD_TYPE, vaultRecordToGraphNode, vaultRecordToNode } from "./emit.js";
import { profileForVerb } from "./profile.js";
import { runReferenceVault } from "./reference.js";
import { VAULT_CAPABILITY, type VaultNote, type VaultProfile } from "./types.js";

// A fixed timestamp — the HOST supplies it; the surface has no clock.
const CREATED_AT_NS = 1_720_000_000_000_000_000;

function baseRecord(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
	return {
		id: "20-Projects/demanda-42.md",
		schemaVersion: CURRENT_RECORD_SCHEMA_VERSION,
		"@type": "refarm:VaultRecord",
		fields: { title: "Demanda 42", state: "doing" },
		sourceRefs: ["20-Projects/demanda-42.md"],
		contentHash: "fnv1a32:deadbeef",
		...overrides,
	};
}

describe("vaultRecordToNode — the OUTPUT projection (no runtime)", () => {
	it("lands on the canonical JSON-LD node shape the silo stores", () => {
		const node = vaultRecordToNode(baseRecord(), {
			createdAtNs: CREATED_AT_NS,
			sourcePlugin: "@demo/vault-extract",
		});

		// The shape every producer emits: @context / @type / @id + provenance.
		expect(node["@context"]).toBe("https://schema.org/");
		expect(node["@type"]).toBe("refarm:VaultRecord");
		expect(node["@id"]).toBe("20-Projects/demanda-42.md");
		expect(node["refarm:sourcePlugin"]).toBe("@demo/vault-extract");
		expect(node["refarm:capability"]).toBe(VAULT_CAPABILITY);
		// The host-stamped clock becomes an ISO string.
		expect(node["refarm:createdAt"]).toBe(new Date(1_720_000_000_000).toISOString());
		// The record's structured payload rides through, nothing lost.
		expect(node.fields).toEqual({ title: "Demanda 42", state: "doing" });
		expect(node.sourceRefs).toEqual(["20-Projects/demanda-42.md"]);
		expect(node.contentHash).toBe("fnv1a32:deadbeef");
	});

	it("round-trips back to a GraphNode via normalisedToGraphNode", () => {
		const node = vaultRecordToNode(baseRecord(), { createdAtNs: CREATED_AT_NS });
		const graph = normalisedToGraphNode(node);
		expect(graph["@id"]).toBe("20-Projects/demanda-42.md");
		expect(graph["@type"]).toBe("refarm:VaultRecord");
		expect(graph.created_at_ns).toBe(CREATED_AT_NS);
	});

	it("defaults @type and preserves a @type array under refarm:types", () => {
		const untyped = vaultRecordToGraphNode(baseRecord({ "@type": undefined }), {
			createdAtNs: CREATED_AT_NS,
		});
		expect(untyped["@type"]).toBe(DEFAULT_VAULT_RECORD_TYPE);

		// The node type collapses to the first entry; the whole array is preserved
		// on the OPEN transport node under refarm:types.
		const multi = vaultRecordToNode(
			baseRecord({ "@type": ["refarm:VaultRecord", "schema:Article"] }),
			{ createdAtNs: CREATED_AT_NS },
		);
		expect(multi["@type"]).toBe("refarm:VaultRecord");
		expect(multi["refarm:types"]).toEqual(["refarm:VaultRecord", "schema:Article"]);
	});

	it("the host never leaks a clock into the surface: createdAtNs is an INPUT", () => {
		// Two emits with different host clocks differ only in refarm:createdAt —
		// the surface's record is identical, proving the surface is clock-free.
		const record = baseRecord();
		const a = vaultRecordToNode(record, { createdAtNs: 1_000_000_000 });
		const b = vaultRecordToNode(record, { createdAtNs: 2_000_000_000 });
		expect(a["refarm:createdAt"]).not.toBe(b["refarm:createdAt"]);
		const { "refarm:createdAt": _a, ...restA } = a;
		const { "refarm:createdAt": _b, ...restB } = b;
		expect(restA).toEqual(restB);
	});
});

describe("end-to-end: extract → emit (the full OUTPUT half, no dispatch)", () => {
	it("a note extracted by the reference surface emits a storable node", () => {
		const note: VaultNote = {
			path: "00-Inbox/note.md",
			text: "---\ntitle: Alpha\nstate: doing\n---\n\nbody\n",
		};
		const profile: VaultProfile = {
			name: "p",
			rules: [
				{
					id: "extract-frontmatter",
					verb: "extract",
					match: JSON.stringify({ type: "frontmatter", recordType: "refarm:VaultRecord" }),
				},
			],
		};

		const result = runReferenceVault("extract", note, profileForVerb(profile, "extract"));
		expect(result.records).toHaveLength(1);

		const node = vaultRecordToNode(result.records[0]!, {
			createdAtNs: CREATED_AT_NS,
			sourcePlugin: "@demo/vault-extract",
		});
		expect(node["@id"]).toBe("00-Inbox/note.md");
		expect(node["@type"]).toBe("refarm:VaultRecord");
		expect(node.fields).toEqual({ title: "Alpha", state: "doing" });
		expect(node["refarm:sourcePlugin"]).toBe("@demo/vault-extract");
	});
});
