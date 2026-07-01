import { describe, expect, it } from "vitest";

import {
	computeRecordContentHash,
	createReferenceRecordsProvider,
	type KnowledgeRecord,
	type RecordsManifest,
} from "./index.js";
import {
	parseRecordsYamlLd,
	parseRecordsYamlLdFrontMatter,
	recordFromYamlLdObject,
	recordToYamlLdObject,
	stringifyRecordsYamlLd,
	stringifyRecordsYamlLdFrontMatter,
} from "./yaml.js";

describe("records:v1 YAML-LD codec", () => {
	it("parses YAML-LD front matter into a valid records:v1 record", () => {
		const note = `---
id: record:yaml-note
schemaVersion: 1
"@context": https://refarm.dev/contexts/records/v1
"@type":
  - KnowledgeRecord
  - Note
fields:
  title: YAML note
  status: draft
sections:
  - key: summary
    content: Front matter is the record.
sourceRefs:
  - source:v1:local:/vault/yaml-note.md
review:
  state: draft
future:extension:
  enabled: true
---
# YAML note
`;

		const { record, body } = parseRecordsYamlLdFrontMatter(note);
		const provider = createReferenceRecordsProvider();
		const manifest: RecordsManifest = {
			manifestVersion: 1,
			records: [record],
		};

		expect(body).toContain("# YAML note");
		expect(record.id).toBe("record:yaml-note");
		expect(record.fields.title).toBe("YAML note");
		expect(record["future:extension"]).toEqual({ enabled: true });
		expect(record.contentHash).toBe(computeRecordContentHash(record));
		expect(provider.validate(manifest)).toEqual({ ok: true, failures: [] });
	});

	it("round-trips record -> YAML-LD -> record without losing open vocabulary", () => {
		const record: KnowledgeRecord = {
			id: "record:round-trip",
			schemaVersion: 1,
			"@context": {
				"@vocab": "https://example.test/vocab#",
			},
			"@type": ["KnowledgeRecord", "FutureRecord"],
			fields: {
				title: "Round trip",
			},
			"future:open": {
				mode: "preserve",
			},
			contentHash: "",
		};
		record.contentHash = computeRecordContentHash(record);

		const yaml = stringifyRecordsYamlLd(record);
		const parsed = parseRecordsYamlLd(yaml);

		expect(parsed).toEqual(record);
		expect(recordToYamlLdObject(parsed)["future:open"]).toEqual({ mode: "preserve" });
	});

	it("keeps higher schema versions and unknown keys forward-safe", () => {
		const record = parseRecordsYamlLd(`
id: record:future
schemaVersion: 2
fields:
  title: Future
future:vocabulary:
  confidence: 0.91
`);

		const roundTrip = parseRecordsYamlLd(stringifyRecordsYamlLd(record));

		expect(roundTrip.schemaVersion).toBe(2);
		expect(roundTrip["future:vocabulary"]).toEqual({ confidence: 0.91 });
	});

	it("accepts consumer-supplied mappings without baking vocabulary into the codec", () => {
		const record = recordFromYamlLdObject(
			{
				uri: "record:mapped",
				schema: 1,
				title: "Mapped title",
				status: "ready",
				localTag: "vault-owned",
			},
			{
				propertyKeyMap: {
					id: "uri",
					schemaVersion: "schema",
				},
				fieldKeyMap: {
					title: "title",
					status: "workflowStatus",
				},
			},
		);

		expect(record.id).toBe("record:mapped");
		expect(record.fields).toEqual({
			title: "Mapped title",
			workflowStatus: "ready",
		});
		expect(record.localTag).toBe("vault-owned");
		expect(recordToYamlLdObject(record, { propertyKeyMap: { id: "uri" } }).uri).toBe("record:mapped");
	});

	it("serializes a YAML-LD front matter block while preserving the body boundary", () => {
		const record = parseRecordsYamlLd(`
id: record:body
schemaVersion: 1
fields:
  title: Body
`);
		const markdown = stringifyRecordsYamlLdFrontMatter(record, "# Body\n");
		const parsed = parseRecordsYamlLdFrontMatter(markdown);

		expect(markdown).toMatch(/^---\n/);
		expect(parsed.record).toEqual(record);
		expect(parsed.body).toBe("# Body\n");
	});
});
