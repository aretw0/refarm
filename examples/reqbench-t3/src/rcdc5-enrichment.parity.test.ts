import { describe, expect, it } from "vitest";
import {
	createRcdc5EnrichmentProvider,
	enrichRcdc5Artifacts,
	rcdc5ArtifactToEnrichmentInput,
	RCDC5_ENRICHMENT_RULES,
} from "./rcdc5-enrichment.js";

/**
 * PARITY GATE — rcdc5's REAL enrichment on refarm's shared `enrichment:v1` engine.
 *
 * The oracle below is rcdc5's OWN decision logic (@rcdcp/rm-enrichment/src/runner.ts:
 * `extractMatchText` + `applyRule`, multi-source joined with a SPACE), inlined so it cannot
 * drift. Each case asserts that the generic engine (createRulesEnrichmentProvider, fed rcdc5's
 * real CNPJ/CPF/integração rules) yields the IDENTICAL resulting tag set — proving refarm can
 * operate rcdc5's enrichment without changing a single tag decision.
 *
 * The known engine difference (refarm joins multi-source with `\n`, rcdc5 with a space) is
 * immaterial for these `\b`-anchored / alternation patterns; these cases PROVE it rather than
 * assume it (title-only match, alm_dashboard_terms-only match).
 */

// ─── rcdc5's exact oracle (copied from @rcdcp/rm-enrichment) ──────────────────────────────────

function oracleExtractMatchText(markdown: string, matchSource: string | string[]): string {
	const sources = Array.isArray(matchSource) ? matchSource : [matchSource];
	const parts: string[] = [];
	for (const source of sources) {
		if (source === "body") {
			parts.push(markdown.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] ?? "");
		} else {
			const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1];
			if (frontmatter !== undefined) {
				const captured = frontmatter.match(new RegExp(`^${source}:\\s*"?([^"\\n]+)"?$`, "m"))?.[1];
				if (captured !== undefined) parts.push(captured.trim());
			}
		}
	}
	return parts.join(" ");
}

function oracleTags(markdown: string): string[] {
	const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (frontmatter === undefined) return [];
	const tagsBody = frontmatter.match(/(?:^|\n)tags:\n((?:[ \t]+-[^\n]*\n?)*)/)?.[1];
	if (tagsBody === undefined) return [];
	const result: string[] = [];
	for (const line of tagsBody.split("\n")) {
		const captured = line.match(/^\s+-\s+"?([^"\n]+?)"?\s*$/)?.[1];
		if (captured !== undefined) result.push(captured.trim());
	}
	return result;
}

/** rcdc5's full pass: apply every rule in order, idempotent, returning the resulting tag list. */
function oracleEnrich(markdown: string): string[] {
	const tags = oracleTags(markdown);
	for (const rule of RCDC5_ENRICHMENT_RULES) {
		if (tags.includes(rule.outputTag)) continue; // idempotent guard
		const text = oracleExtractMatchText(markdown, rule.matchSource);
		if (!text) continue;
		if (!new RegExp(rule.matchPattern as string, "i").test(text)) continue;
		tags.push(rule.outputTag);
	}
	return tags;
}

// ─── the engine's resulting tag list for one artifact (the operate path: select → enrich) ─────

async function engineTags(id: string, markdown: string): Promise<string[]> {
	const provider = createRcdc5EnrichmentProvider();
	const input = rcdc5ArtifactToEnrichmentInput(id, markdown);
	const result = await provider.enrich([input], { mode: "apply" });
	const record = result.records[0];
	const change = record?.changes.find((c) => c.field === "tags");
	// No change → tags unchanged (skip); a change carries the resulting tag list in `after`.
	return change ? (change.after as string[]) : (input.fields.tags as string[]);
}

// ─── fixtures (rcdc5's frontmatter shape) ─────────────────────────────────────────────────────

function makeMarkdown(
	frontmatter: Record<string, string>,
	body: string,
	tags: string[] = ["req/placeholder", "sistema/test"],
): string {
	const fmLines = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
	const tagsYaml = `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`;
	return `---\n${fmLines}\n${tagsYaml}\n---\n${body}`;
}

const BASE = { alm_artifact_uri: "https://alm.serpro/rm/resources/CDU001", title: "Consultar documento" };

const CASES: Array<{ name: string; md: string }> = [
	{ name: "body match → cnpj", md: makeMarkdown(BASE, "O sistema deve validar o CNPJ informado.") },
	{
		name: "title-only match (multi-source body+title) → cnpj",
		md: makeMarkdown({ ...BASE, title: "Consultar CNPJ do contribuinte" }, "Sem menção no corpo."),
	},
	{ name: "body match → cpf", md: makeMarkdown(BASE, "Validar o CPF do responsável.") },
	{ name: "body+title both match cnpj", md: makeMarkdown({ ...BASE, title: "CNPJ" }, "Informe o CNPJ.") },
	{ name: "body has cnpj and cpf → both", md: makeMarkdown(BASE, "Validar CNPJ e CPF do contribuinte.") },
	{ name: "integração via body word", md: makeMarkdown(BASE, "Descreve a integração com o sistema externo.") },
	{
		name: "integração via alm_dashboard_terms only (webservice)",
		md: makeMarkdown({ ...BASE, alm_dashboard_terms: "webservice, consulta" }, "Corpo sem os termos."),
	},
	{ name: "integração via API alternation", md: makeMarkdown(BASE, "Expõe uma API REST para consulta.") },
	{ name: "no match", md: makeMarkdown(BASE, "Sem referência a documento fiscal ou integração.") },
	{
		name: "idempotent: cnpj already present",
		md: makeMarkdown(BASE, "O CNPJ é exigido.", ["req/placeholder", "rcdc5/cnpj"]),
	},
	{
		name: "partial guard: cnpj present, body has cnpj+cpf → adds only cpf",
		md: makeMarkdown(BASE, "Validar CNPJ e CPF.", ["req/placeholder", "rcdc5/cnpj"]),
	},
	{ name: "case-insensitive body match", md: makeMarkdown(BASE, "validar cnpj do parceiro.") },
];

describe("rcdc5 real enrichment on the shared enrichment:v1 engine (parity gate)", () => {
	for (const testCase of CASES) {
		it(`engine ≡ rcdc5 runner: ${testCase.name}`, async () => {
			const oracle = oracleEnrich(testCase.md);
			const engine = await engineTags(testCase.name, testCase.md);
			// Order-insensitive set equality: rcdc5 injects added tags in rule order; the engine
			// appends in the same order, but we compare as sets so the gate is about DECISIONS.
			expect(new Set(engine)).toEqual(new Set(oracle));
		});
	}

	it("sanity: the oracle is non-trivial (a body CNPJ actually tags rcdc5/cnpj)", () => {
		expect(oracleEnrich(makeMarkdown(BASE, "Valida o CNPJ."))).toContain("rcdc5/cnpj");
	});
});

describe("rcdc5 enrichment drives through the enrichment:v1 contract (operate surface)", () => {
	it("describe() reports rcdc5's provider identity, the tag field it writes, and the sources it reads", () => {
		const provider = createRcdc5EnrichmentProvider();
		const description = provider.describe();
		expect(description.providerId).toBe("rcdc5.rm-enrichment");
		expect(description.addsFields).toEqual(["tags"]);
		expect(description.needsKeyFrom).toEqual(
			[...new Set(["body", "title", "alm_dashboard_terms"])].sort(),
		);
	});

	it("select() keeps artifacts with a readable source and drops the empty one", () => {
		const provider = createRcdc5EnrichmentProvider();
		const withBody = rcdc5ArtifactToEnrichmentInput("a", makeMarkdown(BASE, "Tem CNPJ."));
		const empty = { id: "b", fields: { tags: [] as string[] } };
		const selected = provider.select([withBody, empty]);
		expect(selected.map((s) => s.id)).toEqual(["a"]);
	});

	it("enrichRcdc5Artifacts returns an enrichment:v1 result with faithful diagnostics", async () => {
		const result = await enrichRcdc5Artifacts(
			[
				{ id: "1", markdown: makeMarkdown(BASE, "Valida o CNPJ.") },
				{ id: "2", markdown: makeMarkdown(BASE, "Sem termos fiscais.") },
			],
			{ mode: "apply" },
		);
		expect(result.mode).toBe("apply");
		expect(result.diagnostics.total).toBe(2);
		expect(result.diagnostics.enriched).toBe(1); // only artifact 1 gains a tag
		const enriched = result.records.find((r) => r.changes.length > 0);
		expect(enriched?.changes[0]?.field).toBe("tags");
		expect(enriched?.changes[0]?.after).toContain("rcdc5/cnpj");
		// Provenance names the rule that fired — the audit trail rcdc5 gets for free.
		expect(enriched?.changes[0]?.provenance.providerId).toBe("rcdc5.rm-enrichment");
	});
});
