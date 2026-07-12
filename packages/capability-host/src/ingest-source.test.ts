import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	ingestSourceToRecords,
	type IngestSourceProvider,
	type SourceRecordParser,
} from "./ingest-source.js";

/** A parser that turns `<article data-id=… data-title=…>text</article>` into records —
 * stands in for a domain parser (a requirements app parsing its ALM HTML). */
const parseArticles: SourceRecordParser = (body, context) => {
	const records: ReturnType<SourceRecordParser> = [];
	const re = /<article data-id="([^"]+)" data-title="([^"]+)">([^<]*)<\/article>/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(body)) !== null) {
		const [, id, title, text] = match;
		records.push({
			id: `record:${id}`,
			schemaVersion: 1,
			"@type": ["KnowledgeRecord"],
			fields: { title, body: text },
			sourceRefs: [context.ref],
		});
	}
	return records;
};

describe("ingestSourceToRecords — the source → records seam", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "refarm-ingest-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	/** A mock provider that materializes to `<dir>/<ref>/content.html` (source-web's layout). */
	function mockProvider(body: string): IngestSourceProvider {
		return {
			async materialize(ref: string) {
				const loc = join(dir, ref.replace(/[^a-z0-9]/gi, "_"));
				await mkdir(loc, { recursive: true });
				await writeFile(join(loc, "content.html"), body, "utf-8");
				return { location: { path: loc } };
			},
		};
	}

	it("materializes, reads the snapshot body, parses it into records with content hashes", async () => {
		const body =
			'<article data-id="RN-1" data-title="The rule">rule text</article>' +
			'<article data-id="CDU-1" data-title="The use case">case text</article>';
		const result = await ingestSourceToRecords({
			sourceProvider: mockProvider(body),
			ref: "web:efd",
			parse: parseArticles,
		});
		expect(result.records).toHaveLength(2);
		expect(result.records[0]?.id).toBe("record:RN-1");
		expect(result.records[0]?.fields.title).toBe("The rule");
		expect(result.records[0]?.sourceRefs).toEqual(["web:efd"]);
		// Ingest stamps a content hash on each record.
		expect(result.records[0]?.contentHash).toMatch(/^fnv1a32:/);
	});

	it("is idempotent at the record level — same body → same records + hashes", async () => {
		const body = '<article data-id="RN-1" data-title="R">t</article>';
		const provider = mockProvider(body);
		const a = await ingestSourceToRecords({ sourceProvider: provider, ref: "web:x", parse: parseArticles });
		const b = await ingestSourceToRecords({ sourceProvider: provider, ref: "web:x", parse: parseArticles });
		expect(a.records[0]?.contentHash).toBe(b.records[0]?.contentHash);
	});

	it("throws INGEST_NO_BODY when the snapshot has no readable body", async () => {
		const emptyProvider: IngestSourceProvider = {
			async materialize() {
				const loc = join(dir, "empty");
				await mkdir(loc, { recursive: true });
				return { location: { path: loc } };
			},
		};
		await expect(
			ingestSourceToRecords({ sourceProvider: emptyProvider, ref: "web:x", parse: parseArticles }),
		).rejects.toThrow(/INGEST_NO_BODY/);
	});

	it("passes the ref + location to the parser as context", async () => {
		let seenRef = "";
		const provider = mockProvider("<article data-id=\"A\" data-title=\"A\">x</article>");
		await ingestSourceToRecords({
			sourceProvider: provider,
			ref: "web:my-system",
			parse: (body, ctx) => {
				seenRef = ctx.ref;
				expect(ctx.location).toContain("web_my_system");
				return parseArticles(body, ctx);
			},
		});
		expect(seenRef).toBe("web:my-system");
	});
});
