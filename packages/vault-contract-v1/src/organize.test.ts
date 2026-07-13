import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import { organizeRecords, recordToVaultNote } from "./organize.js";
import { createReferenceVaultSurface } from "./reference.js";
import type { VaultProfile } from "./types.js";

function record(id: string, fields: Record<string, unknown>): KnowledgeRecord {
	return {
		id,
		schemaVersion: 1,
		"@type": ["KnowledgeRecord"],
		fields,
		contentHash: "x",
	} as KnowledgeRecord;
}

const taxonomyProfile: VaultProfile = {
	name: "para",
	rules: [
		{
			id: "route",
			verb: "organize",
			match: JSON.stringify({
				type: "taxonomy-route",
				axes: [
					{ field: "tipo", map: { demanda: "20-Projects", requisito: "40-Resources" } },
					{ field: "sistema", map: { EFD: "20-Projects/EFD" } },
				],
				fallback: "40-Resources/Triagem",
			}),
		},
	],
};

describe("recordToVaultNote", () => {
	it("renders fields as frontmatter a taxonomy-route can read", () => {
		const note = recordToVaultNote(record("record:req-1", { tipo: "requisito", sistema: "EFD" }));
		expect(note.path).toBe("record:req-1");
		expect(note.text).toContain("tipo: requisito");
		expect(note.text).toContain("sistema: EFD");
	});

	it("renders object/array fields as a present JSON scalar (a gate sees the key; routing skips it)", () => {
		const note = recordToVaultNote(record("r", { tipo: "demanda", provenance: { channel: "pull" }, tags: ["x"] }));
		expect(note.text).toContain("tipo: demanda");
		// The KEY is present (so frontmatter-required sees it) and the value is readable JSON.
		expect(note.text).toContain('provenance: {"channel":"pull"}');
		expect(note.text).toContain('tags: ["x"]');
	});
});

describe("organizeRecords — one-call PARA routing over records", () => {
	const surface = createReferenceVaultSurface();

	it("routes each record and keys the plan back to its record", async () => {
		const records = [
			record("record:req-1", { tipo: "requisito" }),
			record("record:dem-2", { tipo: "demanda" }),
			record("record:sys-3", { tipo: "outro", sistema: "EFD" }),
			record("record:fb-4", { tipo: "desconhecido" }),
		];
		const plans = await organizeRecords(surface, records, taxonomyProfile);

		const byRecord = Object.fromEntries(plans.map((p) => [p.recordId, p.destination]));
		expect(byRecord["record:req-1"]).toBe("40-Resources"); // by tipo
		expect(byRecord["record:dem-2"]).toBe("20-Projects"); // by tipo
		expect(byRecord["record:sys-3"]).toBe("20-Projects/EFD"); // second axis (sistema)
		expect(byRecord["record:fb-4"]).toBe("40-Resources/Triagem"); // fallback
		expect(plans).toHaveLength(4);
	});

	it("yields no plan for a record that matches nothing and has no fallback", async () => {
		const noFallback: VaultProfile = {
			name: "nf",
			rules: [
				{
					id: "route",
					verb: "organize",
					match: JSON.stringify({
						type: "taxonomy-route",
						axes: [{ field: "tipo", map: { requisito: "40-Resources" } }],
					}),
				},
			],
		};
		const plans = await organizeRecords(surface, [record("r", { tipo: "outro" })], noFallback);
		expect(plans).toHaveLength(0);
	});
});
