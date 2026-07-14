import { computeRecordContentHash, type KnowledgeRecord, type RecordsManifest } from "@refarm.dev/records-contract-v1";
import { mergeAndRecord } from "@refarm.dev/history-contract-v1";
import { describe, expect, it } from "vitest";

import { buildVaultOverview, vaultOverviewToHtml } from "./vault-overview.js";

function req(id: string, fields: Record<string, unknown>, relations?: KnowledgeRecord["relations"]): KnowledgeRecord {
	const record = {
		id,
		schemaVersion: 1,
		"@type": ["KnowledgeRecord", "Requirement"],
		fields,
		...(relations ? { relations } : {}),
		contentHash: "",
	} as KnowledgeRecord;
	record.contentHash = computeRecordContentHash(record); // real hash so revisions dedup correctly
	return record;
}

describe("buildVaultOverview — the vault in one view", () => {
	it("aggregates coverage, traceability, and health from the manifest", () => {
		const records = [
			req("record:a", { sistema: "EFD", tipo: "requisito", status: "draft" }, [
				{ type: "references", target: "record:b" }, // in-corpus edge
				{ type: "references", target: "urn:external", attrs: { external: true } }, // not counted
			]),
			req("record:b", { sistema: "NFE", tipo: "funcional", status: "reviewed" }, [
				{ type: "elaborates", target: "record:a" },
			]),
			req("record:lonely", { sistema: "EFD", tipo: "requisito", status: "draft" }), // orphan
		];
		const overview = buildVaultOverview({ manifestVersion: 1, records } as RecordsManifest);
		expect(overview.total).toBe(3);
		expect(overview.bySistema).toEqual({ EFD: 2, NFE: 1 });
		expect(overview.byTipo).toEqual({ requisito: 2, funcional: 1 });
		// Two in-corpus relations (a→b, b→a); the external one is not counted.
		expect(overview.relations).toBe(2);
		// record:lonely is isolated → one orphan.
		expect(overview.health.orphans).toBe(1);
		expect(overview.health.healthy).toBe(false);
	});

	it("reports the last change from the revision history", () => {
		let manifest: RecordsManifest = { manifestVersion: 1, records: [] } as RecordsManifest;
		manifest = mergeAndRecord(manifest, [req("record:a", { title: "v1" })], () => "2026-07-14T00:00:01.000Z", "pull");
		manifest = mergeAndRecord(manifest, [req("record:a", { title: "v2" })], () => "2026-07-14T00:00:02.000Z", "correct");
		const overview = buildVaultOverview(manifest);
		expect(overview.lastChange).toMatchObject({ origin: "correct", totalRevisions: 2 });
	});

	it("counts materialized attachments (typed array or the loose field)", () => {
		const records = [
			req("record:a", {}),
			{ ...req("record:withatt", {}), attachments: [{ id: "att-1", ref: "attachments/h.png" }] } as KnowledgeRecord,
			req("record:loose", { attachmentHash: "abc" }),
		];
		expect(buildVaultOverview({ manifestVersion: 1, records } as RecordsManifest).attachments).toBe(2);
	});

	it("vaultOverviewToHtml renders a healthy vault + escapes", () => {
		const html = vaultOverviewToHtml({
			total: 5,
			bySistema: { EFD: 5 },
			byTipo: { requisito: 5 },
			byStatus: { draft: 5 },
			relations: 3,
			attachments: 0,
			health: { healthy: true, orphans: 0, duplicates: 0, dangling: 0 },
			lastChange: { origin: "pull", recordedAt: "2026-07-14T00:00:00Z", totalRevisions: 5 },
		});
		expect(html).toContain("data-vault-overview");
		expect(html).toContain("5 requirements");
		expect(html).toContain("healthy");
		expect(html).toContain("EFD: <strong>5</strong>");
	});
});
