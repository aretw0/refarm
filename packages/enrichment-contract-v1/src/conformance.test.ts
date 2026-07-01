import { describe, expect, it } from "vitest";

import {
	ENRICHMENT_CAPABILITY,
	createReferenceEnrichmentProvider,
	runEnrichmentV1Conformance,
	type EnrichmentProvider,
} from "./index.js";

describe("enrichment:v1 conformance", () => {
	it("passes for the reference fixture provider", async () => {
		const provider = createReferenceEnrichmentProvider();
		const result = await runEnrichmentV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("produces deterministic dry-run and apply changes", async () => {
		const provider = createReferenceEnrichmentProvider();
		const inputs = [
			{
				id: "note-1",
				fields: { externalKey: "REQ-1" },
				sourceRef: "local:/requirements/note-1.md",
			},
		];

		const dryRun = await provider.enrich(inputs, { mode: "dry-run" });
		const applied = await provider.enrich(inputs, { mode: "apply" });

		expect(dryRun.records[0]?.changes).toEqual(applied.records[0]?.changes);
		expect(dryRun.diagnostics).toEqual({
			total: 1,
			enriched: 1,
			skipped: 0,
			byCode: {},
		});
		expect(dryRun.records[0]?.changes[0]?.provenance).toMatchObject({
			providerId: "refarm.reference-enrichment",
			ruleId: "fixture-map",
			key: "REQ-1",
			sourceRef: "fixture:enrichment/reference#REQ-1",
		});
		expect(dryRun.records[0]?.changes[0]?.provenance.hash).toMatch(/^fnv1a32:/);
	});

	it("reports actionable failures for an incompatible provider", async () => {
		const provider: EnrichmentProvider = {
			pluginId: "",
			capability: "enrichment:v0" as typeof ENRICHMENT_CAPABILITY,
			describe: () => ({ providerId: "", needsKeyFrom: [], addsFields: [] }),
			select: () => [],
			enrich: async () => ({
				mode: "dry-run",
				records: [],
				diagnostics: {
					total: 99,
					enriched: 0,
					skipped: 0,
					byCode: {},
				},
			}),
		};

		const result = await runEnrichmentV1Conformance(provider);

		expect(result.pass).toBe(false);
		expect(result.failures).toContain("provider.capability must be 'enrichment:v1'");
		expect(result.failures).toContain("provider.pluginId must be a non-empty string");
		expect(result.failures).toContain("describe().providerId must be a non-empty string");
		expect(result.failures).toContain("select() must include compatible inputs");
	});
});
