import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import { createRequirementsMaterializeCapability } from "./persona.js";

/** A minimal in-memory records deps: a fixed manifest, no save. */
function recordsDeps(records: KnowledgeRecord[]) {
	return {
		loadManifest: () => ({ records }),
	} as unknown as Parameters<typeof createRequirementsMaterializeCapability>[0];
}

function req(externalKey: string, title: string, tipo: string, artifactUri: string): KnowledgeRecord {
	return {
		id: `record:req-${externalKey.toLowerCase()}`,
		schemaVersion: 1,
		"@type": ["KnowledgeRecord", "Requirement"],
		fields: { externalKey, title, tipo, artifactUri, body: "corpo" },
		sections: [{ key: "conteudo", content: "corpo" }],
		contentHash: "x",
	} as KnowledgeRecord;
}

// A trivial surface that routes nothing (materialize still works — notes land at the root).
const noRouteSurface = async () => ({ run: async () => ({ plans: [] }) });

describe("requirements-materialize — records → Obsidian notes on disk", () => {
	const records = [
		req("RN-1", "Regra Um", "regra-de-negocio", "https://alm.example/rm/resources/TX_10"),
		req("CDU-2", "Caso Dois", "caso-de-uso", "https://alm.example/rm/resources/TX_11"),
	];

	it("plans a file per record, named by the ALM external key, with ALM frontmatter", async () => {
		const written = new Map<string, string>();
		const cap = createRequirementsMaterializeCapability(recordsDeps(records), noRouteSurface, {
			vaultRoot: "/vault",
			writeNote: (rel, text) => {
				written.set(rel, text);
				return true;
			},
			now: () => "2026-07-13T00:00:00Z",
		});
		const env = await cap.run({ args: {}, options: { apply: true } } as never);
		const extra = env as unknown as { planned: number; written: number; files: { path: string }[] };
		expect(extra.planned).toBe(2);
		expect(extra.written).toBe(2);
		expect(extra.files.map((f) => f.path).sort()).toEqual(["CDU-2.md", "RN-1.md"]);
		// ALM canonical frontmatter is stamped for a later incremental sync.
		const rn1 = written.get("RN-1.md")!;
		expect(rn1).toContain("alm_artifact_uri: https://alm.example/rm/resources/TX_10");
		expect(rn1).toContain("alm_last_sync_at: 2026-07-13T00:00:00Z");
		expect(rn1).toContain("title: Regra Um");
	});

	it("a requirement with a MULTI-LINE body materializes with INTACT frontmatter", async () => {
		// The real T3 case: fields.body = htmlToMarkdown(primaryText) is multi-line markdown. The
		// materialized note must NOT have its --- fence broken by that body (the frontmatter-corruption
		// bug). recordToVaultNote JSON-encodes multi-line values, so the block stays valid.
		const multi: KnowledgeRecord = {
			id: "record:req-rn9",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "Requirement"],
			fields: {
				externalKey: "RN-9",
				title: "Regra Multilinha",
				tipo: "regra-de-negocio",
				body: "Primeira linha.\n\n## Critérios de aceitação\n- Item A\n- Item B",
			},
			sections: [{ key: "conteudo", content: "corpo" }],
			contentHash: "x",
		} as KnowledgeRecord;
		const written = new Map<string, string>();
		const cap = createRequirementsMaterializeCapability(recordsDeps([multi]), noRouteSurface, {
			vaultRoot: "/vault",
			writeNote: (rel, text) => {
				written.set(rel, text);
				return true;
			},
			now: () => "2026-07-13T00:00:00Z",
		});
		await cap.run({ args: {}, options: { apply: true } } as never);
		const note = written.get("RN-9.md")!;
		// The frontmatter block is intact: exactly two `---` fences, the routable scalars readable.
		expect(note.match(/^---$/gm)).toHaveLength(2);
		expect(note).toContain("tipo: regra-de-negocio");
		// The multi-line body did NOT leak a bare markdown heading into the frontmatter block.
		const block = note.slice(note.indexOf("---") + 3, note.lastIndexOf("---"));
		expect(block).not.toMatch(/^## Critérios de aceitação$/m);
	});

	it("dry-runs (plans without writing) when --apply is absent", async () => {
		let writes = 0;
		const cap = createRequirementsMaterializeCapability(recordsDeps(records), noRouteSurface, {
			vaultRoot: "/vault",
			writeNote: () => {
				writes += 1;
				return true;
			},
		});
		const env = await cap.run({ args: {}, options: {} } as never);
		const extra = env as unknown as { planned: number; written: number; dryRun: boolean };
		expect(extra.planned).toBe(2);
		expect(extra.written).toBe(0);
		expect(extra.dryRun).toBe(true);
		expect(writes).toBe(0);
	});

	it("is idempotent — a second materialize of unchanged records skips every write", async () => {
		const store = new Map<string, string>();
		const writeNote = (rel: string, text: string): boolean => {
			if (store.get(rel) === text) return false; // unchanged → skip
			store.set(rel, text);
			return true;
		};
		const cap = createRequirementsMaterializeCapability(recordsDeps(records), noRouteSurface, {
			vaultRoot: "/vault",
			writeNote,
			now: () => "2026-07-13T00:00:00Z", // same clock → identical content
		});
		const first = await cap.run({ args: {}, options: { apply: true } } as never);
		expect((first as unknown as { written: number }).written).toBe(2);
		const second = await cap.run({ args: {}, options: { apply: true } } as never);
		const extra = second as unknown as { written: number; skipped: number };
		expect(extra.written).toBe(0);
		expect(extra.skipped).toBe(2);
	});
});
