import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import {
	organizeRecords,
	planRecordFiles,
	recordToVaultNote,
	searchProfileForQuery,
	searchRecords,
} from "./organize.js";
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

describe("searchRecords — one-call query over records (the same surface that routes, searches)", () => {
	const surface = createReferenceVaultSurface();

	function reqWithBody(id: string, fields: Record<string, unknown>, body: string): KnowledgeRecord {
		return {
			id,
			schemaVersion: 1,
			"@type": ["KnowledgeRecord"],
			fields,
			sections: [{ key: "description", content: body }],
			contentHash: "x",
		} as KnowledgeRecord;
	}

	it("searchProfileForQuery turns a query into one contains-rule per term (matcher-is-data)", () => {
		const profile = searchProfileForQuery("nota fiscal");
		expect(profile.rules).toHaveLength(2);
		expect(profile.rules.every((r) => r.verb === "search")).toBe(true);
		expect(profile.rules[0]?.match).toContain("contains");
		expect(profile.rules[0]?.match).toContain("nota");
		// An empty query yields no rules.
		expect(searchProfileForQuery("   ").rules).toHaveLength(0);
	});

	it("finds records whose note text (frontmatter OR body) contains the term, keyed back to the record", async () => {
		const records = [
			reqWithBody("record:req-1", { tipo: "requisito", sistema: "EFD" }, "O sistema deve emitir a nota fiscal eletrônica."),
			reqWithBody("record:req-2", { tipo: "demanda", sistema: "SPED" }, "Cálculo de imposto sobre serviços."),
			reqWithBody("record:req-3", { tipo: "requisito", sistema: "EFD" }, "Validação da nota de entrada."),
		];
		// Body-term match.
		const fiscalHits = await searchRecords(surface, records, "fiscal");
		expect(fiscalHits.map((h) => h.recordId)).toEqual(["record:req-1"]);
		// Frontmatter-term match (the field value is in the note text).
		const efdHits = await searchRecords(surface, records, "EFD");
		expect(new Set(efdHits.map((h) => h.recordId))).toEqual(new Set(["record:req-1", "record:req-3"]));
		// Multi-term: "nota" is in req-1 and req-3.
		const notaHits = await searchRecords(surface, records, "nota");
		expect(new Set(notaHits.map((h) => h.recordId))).toEqual(new Set(["record:req-1", "record:req-3"]));
		// Each hit carries a locus the host can render.
		expect(fiscalHits[0]?.locus).toBeTruthy();
	});

	it("an empty query returns no hits (no dispatch)", async () => {
		const hits = await searchRecords(surface, [record("r", { tipo: "requisito" })], "");
		expect(hits).toHaveLength(0);
	});
});

describe("planRecordFiles — records → writable note files (pure)", () => {
	it("places a routed record in its organize plan's destination + fileName", () => {
		const rec = record("record:req-rn1", { title: "Regra Um", tipo: "regra-de-negocio" });
		const files = planRecordFiles([rec], {
			plans: [
				{ recordId: "record:req-rn1", destination: "1-Projetos/EFD", fileName: "RN-1.md", path: "x", ruleId: "route" },
			],
		});
		expect(files).toHaveLength(1);
		expect(files[0]?.destination).toBe("1-Projetos/EFD");
		expect(files[0]?.fileName).toBe("RN-1.md");
		expect(files[0]?.relativePath).toBe("1-Projetos/EFD/RN-1.md");
		// The text is frontmatter + body (the note render).
		expect(files[0]?.text).toContain("title: Regra Um");
	});

	it("materializes an unrouted record at the root with a slugified name", () => {
		const files = planRecordFiles([record("r1", { title: "Título com Acentuação!" })]);
		expect(files[0]?.destination).toBe("");
		expect(files[0]?.fileName).toBe("titulo-com-acentuacao.md");
		expect(files[0]?.relativePath).toBe("titulo-com-acentuacao.md");
	});

	it("honors a fileNameFor override (e.g. the ALM external key)", () => {
		const rec = record("r1", { title: "x", externalKey: "RN-632504" });
		const files = planRecordFiles([rec], {
			fileNameFor: (r) => `${String(r.fields.externalKey)}.md`,
		});
		expect(files[0]?.fileName).toBe("RN-632504.md");
	});
});
