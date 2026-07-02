import { describe, expect, it } from "vitest";

import {
	CURRENT_RECORD_SCHEMA_VERSION,
	RECORDS_CAPABILITY,
	computeRecordContentHash,
	createReferenceRecordsFixture,
	createReferenceRecordsProvider,
	runRecordsV1Conformance,
	type RecordsManifest,
	type RecordsProvider,
} from "./index.js";

describe("records:v1 conformance", () => {
	it("passes for the reference provider", async () => {
		const provider = createReferenceRecordsProvider();
		const result = await runRecordsV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("reports dangling relations", () => {
		const provider = createReferenceRecordsProvider();
		const fixture = createReferenceRecordsFixture();
		const child = fixture.records.find((record) => record.id === "record:requirements-child");
		expect(child?.relations?.[0]).toBeDefined();
		if (child?.relations?.[0]) {
			child.relations[0] = { ...child.relations[0], target: "record:missing" };
			child.contentHash = computeRecordContentHash(child);
		}

		const result = provider.validate(fixture);

		expect(result.ok).toBe(false);
		expect(result.failures.some((failure) => failure.message.includes("relation target does not exist"))).toBe(true);
	});

	it("preserves unknown fields while upcasting older records", () => {
		const provider = createReferenceRecordsProvider();
		const fixture = createReferenceRecordsFixture();
		const record = {
			...fixture.records[0],
			schemaVersion: 0,
			"future:extension": {
				enabled: true,
			},
		};

		const upcast = provider.upcast(record);

		expect(upcast.schemaVersion).toBe(CURRENT_RECORD_SCHEMA_VERSION);
		expect(upcast["future:extension"]).toEqual({ enabled: true });
		expect(upcast.id).toBe(record.id);
	});

	it("reports actionable failures for an incompatible provider", async () => {
		const provider: RecordsProvider = {
			pluginId: "",
			capability: "records:v0" as typeof RECORDS_CAPABILITY,
			validate: () => ({ ok: true, failures: [] }),
			upcast: (record) => record,
		};

		const result = await runRecordsV1Conformance(provider);

		expect(result.pass).toBe(false);
		expect(result.failures).toContain("provider.capability must be 'records:v1'");
		expect(result.failures).toContain("provider.pluginId must be a non-empty string");
		expect(result.failures).toContain("dangling relation targets must fail validation");
	});

	it("keeps manifest vocabulary open", () => {
		const provider = createReferenceRecordsProvider();
		const fixture: RecordsManifest = createReferenceRecordsFixture();
		const record = fixture.records[0];
		expect(record).toBeDefined();
		if (record) {
			record["@type"] = ["KnowledgeRecord", "FutureVocabulary"];
			record.review = { state: "future-review-state" };
			record.contentHash = computeRecordContentHash(record);
		}

		const result = provider.validate(fixture);

		expect(result.ok).toBe(true);
	});
});
