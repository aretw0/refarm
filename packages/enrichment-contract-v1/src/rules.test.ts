import { describe, expect, it } from "vitest";

import {
	createRulesEnrichmentProvider,
	runEnrichmentV1Conformance,
	type EnrichmentInput,
	type EnrichmentRule,
} from "./index.js";

const RULES: EnrichmentRule[] = [
	{ id: "tag-cnpj", matchSource: ["body", "title"], matchPattern: "\\bCNPJ\\b", outputTag: "cnpj" },
	{ id: "tag-integration", matchSource: "body", matchPattern: /integra|API|REST/i, outputTag: "integration" },
];

function input(id: string, fields: Record<string, unknown>): EnrichmentInput {
	return { id, fields, sourceRef: `fixture:rules#${id}` };
}

describe("createRulesEnrichmentProvider — the generic match→tag engine", () => {
	it("adds a tag when a rule pattern matches a source field", async () => {
		const provider = createRulesEnrichmentProvider({ rules: RULES });
		const result = await provider.enrich(
			[input("r1", { title: "Validate the CNPJ", body: "checks the CNPJ format" })],
			{ mode: "apply" },
		);
		const change = result.records[0]?.changes[0];
		expect(change?.field).toBe("sovereign.tags");
		expect(change?.after).toEqual(["cnpj"]);
		expect(change?.provenance.ruleId).toBe("tag-cnpj");
		expect(result.diagnostics.enriched).toBe(1);
	});

	it("applies multiple matching rules in one change", async () => {
		const provider = createRulesEnrichmentProvider({ rules: RULES });
		const result = await provider.enrich(
			[input("r2", { body: "the CNPJ is fetched over a REST API" })],
			{ mode: "apply" },
		);
		expect(result.records[0]?.changes[0]?.after).toEqual(["cnpj", "integration"]);
		expect(result.records[0]?.changes[0]?.provenance.ruleId).toBe("tag-cnpj,tag-integration");
	});

	it("is IDEMPOTENT — a tag already present yields no change (skipped NO_MATCH)", async () => {
		const provider = createRulesEnrichmentProvider({ rules: RULES });
		const result = await provider.enrich(
			[input("r3", { body: "mentions CNPJ", "sovereign.tags": ["cnpj"] })],
			{ mode: "apply" },
		);
		expect(result.records[0]?.changes).toEqual([]);
		expect(result.records[0]?.skipped?.code).toBe("NO_MATCH");
		expect(result.diagnostics.enriched).toBe(0);
	});

	it("is NON-DESTRUCTIVE — preserves existing tags, only appends", async () => {
		const provider = createRulesEnrichmentProvider({ rules: RULES });
		const result = await provider.enrich(
			[input("r4", { body: "CNPJ here", "sovereign.tags": ["reviewed", "custom"] })],
			{ mode: "apply" },
		);
		expect(result.records[0]?.changes[0]?.after).toEqual(["reviewed", "custom", "cnpj"]);
	});

	it("skips NO_MATCH when a record has sources but nothing matches", async () => {
		const provider = createRulesEnrichmentProvider({ rules: RULES });
		const result = await provider.enrich([input("r5", { body: "nothing relevant here" })], {
			mode: "apply",
		});
		expect(result.records[0]?.changes).toEqual([]);
		expect(result.records[0]?.skipped?.code).toBe("NO_MATCH");
	});

	it("skips NO_KEY when a record has none of the rule source fields", async () => {
		const provider = createRulesEnrichmentProvider({ rules: RULES });
		const result = await provider.enrich([input("r5b", { unrelated: "x" })], { mode: "apply" });
		expect(result.records[0]?.skipped?.code).toBe("NO_KEY");
	});

	it("matches array/object fields by stringifying them", async () => {
		const provider = createRulesEnrichmentProvider({
			rules: [{ id: "tag-x", matchSource: "terms", matchPattern: "needle", outputTag: "x" }],
		});
		const result = await provider.enrich(
			[input("r6", { terms: ["hay", "needle", "stack"] })],
			{ mode: "apply" },
		);
		expect(result.records[0]?.changes[0]?.after).toEqual(["x"]);
	});

	it("respects a custom tagField", async () => {
		const provider = createRulesEnrichmentProvider({
			rules: [{ id: "tag-x", matchSource: "body", matchPattern: "hit", outputTag: "x" }],
			tagField: "labels",
		});
		const result = await provider.enrich([input("r7", { body: "a hit" })], { mode: "apply" });
		expect(result.records[0]?.changes[0]?.field).toBe("labels");
	});

	it("describe() reports the tag field it writes and the sources it reads", () => {
		const provider = createRulesEnrichmentProvider({ rules: RULES });
		const d = provider.describe();
		expect(d.addsFields).toEqual(["sovereign.tags"]);
		expect(d.needsKeyFrom).toEqual(["body", "title"]);
	});

	it("passes enrichment:v1 conformance", async () => {
		// The rules provider must be a conformant enrichment:v1 provider. The conformance
		// fixture expects one input to enrich (externalKey REQ-1) and one to skip NO_MATCH
		// (REQ-404). A rule matching REQ-1 but not REQ-404 satisfies both.
		const provider = createRulesEnrichmentProvider({
			rules: [{ id: "conf", matchSource: "externalKey", matchPattern: /REQ-1\b/, outputTag: "seen" }],
		});
		const conformance = await runEnrichmentV1Conformance(provider);
		expect(conformance.pass).toBe(true);
	});
});
