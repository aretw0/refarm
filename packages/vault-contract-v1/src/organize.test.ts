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
	it("quotes scalars that YAML would otherwise retype", () => {
		const note = recordToVaultNote(
			record("record:evento", {
				// The one that motivated this: unquoted, `[[Arthur]]` is a nested flow sequence and
				// the wikilink parses as `[["Arthur"]]`.
				registrado_por: "[[Arthur]]",
				sim: "true",
				numero: "42",
				dois_pontos: "chave: valor",
				espacos: " folgado ",
				vazio: "",
				normal: "limpeza",
			}),
		);

		expect(note.text).toContain('registrado_por: "[[Arthur]]"');
		expect(note.text).toContain('sim: "true"');
		expect(note.text).toContain('numero: "42"');
		expect(note.text).toContain('dois_pontos: "chave: valor"');
		expect(note.text).toContain('espacos: " folgado "');
		expect(note.text).toContain('vazio: ""');
		// An already-unambiguous scalar stays bare: quoting everything is noise in every note.
		expect(note.text).toContain("normal: limpeza");
	});

	it("leaves real numbers and booleans unquoted", () => {
		const note = recordToVaultNote(
			record("record:evento", { quantidade: 1000, aplicado: false }),
		);

		expect(note.text).toContain("quantidade: 1000");
		expect(note.text).toContain("aplicado: false");
	});

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

	it("renders a record's relations as a Rastreabilidade block (traceability survives into the note)", () => {
		const rec = {
			...record("record:req-1", { tipo: "requisito" }),
			relations: [
				{ type: "elaborates", target: "record:req-2" },
				{ type: "references", target: "record:req-3" },
			],
		} as KnowledgeRecord;
		const note = recordToVaultNote(rec);
		expect(note.text).toContain("## Rastreabilidade");
		expect(note.text).toContain("- elaborates → [[record:req-2]]");
		expect(note.text).toContain("- references → [[record:req-3]]");
	});

	it("omits the Rastreabilidade block when there are no relations", () => {
		const note = recordToVaultNote(record("record:req-1", { tipo: "requisito" }));
		expect(note.text).not.toContain("Rastreabilidade");
	});

	it("a MULTI-LINE field value stays on ONE frontmatter line (never breaks the --- fence)", () => {
		// The real trigger: fields.body = htmlToMarkdown(primaryText) is multi-line markdown. A raw
		// String(value) would split the block; it must be JSON-encoded so the newline escapes to \n.
		const body = "Linha um.\n\n## Critérios\n- Linha três.";
		const note = recordToVaultNote(record("r", { tipo: "requisito", body }));
		// Exactly TWO `---` fences — the block is intact (a mid-value newline would add spurious ones).
		expect(note.text.match(/^---$/gm)).toHaveLength(2);
		// The body renders as a single quoted line with the newline ESCAPED to \n (not a real break).
		expect(note.text).toContain(`body: ${JSON.stringify(body)}`);
		// No BARE `## Critérios` line inside the frontmatter block — it only appears escaped in the
		// quoted value. (A raw String(value) would have put it on its own line, breaking the fence.)
		const block = note.text.slice(note.text.indexOf("---") + 3, note.text.lastIndexOf("---"));
		expect(block).not.toMatch(/^## Critérios$/m);
		// tipo is still a routable plain scalar.
		expect(note.text).toContain("tipo: requisito");
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
