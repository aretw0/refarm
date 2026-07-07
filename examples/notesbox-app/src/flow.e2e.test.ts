import {
	isCapabilityGroup,
	resolveGroupAction,
	type CapabilityEntry,
	type CapabilityGroup,
} from "@refarm.dev/capabilities-v1";
import { parseRecordsYamlLdFrontMatter } from "@refarm.dev/records-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildNotesboxBaseModel, buildNotesboxHost } from "./cli.js";
import { NOTESBOX_SOURCE_REF } from "./fixture.js";
import { createNotesboxRegistry } from "./registry.js";

/**
 * The T3 note-box flow, end-to-end, driven ONLY through the composed registry — the
 * neutral refarm blocks + the notesbox app's own injected deps and work verb. This is
 * the proof of the two-layer model: the app supplies fixtures/manifest/seed, refarm
 * supplies the verbs, and the whole flow runs without any work vocabulary living in
 * refarm.
 */

let sourceCacheRoot = "";
let dirs: string[] = [];

function tempDir(prefix: string): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	dirs.push(d);
	return d;
}

function registry() {
	// Pin the source cache so `source status` sees the `source pull` from the same run.
	return createNotesboxRegistry({ sourceCacheRoot });
}

function group(reg: ReturnType<typeof registry>, name: string): CapabilityGroup {
	const entry = reg.list().find((e: CapabilityEntry) => e.name === name);
	if (!entry || !isCapabilityGroup(entry)) {
		throw new Error(`no group ${name}`);
	}
	return entry;
}

async function runGroup(
	reg: ReturnType<typeof registry>,
	name: string,
	tokens: string[],
): Promise<Record<string, unknown>> {
	const resolved = resolveGroupAction(group(reg, name), tokens);
	if (!resolved) throw new Error(`could not resolve ${name} ${tokens.join(" ")}`);
	return (await resolved.action.run(resolved.input)) as unknown as Record<
		string,
		unknown
	>;
}

beforeEach(() => {
	sourceCacheRoot = tempDir("notesbox-cache-");
});

afterEach(() => {
	for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("notesbox T3 flow (two-layer: neutral blocks + app injections)", () => {
	it("the composed registry carries the neutral verbs AND the app's work verb", () => {
		const reg = registry();
		const names = reg.list().map((e) => e.name).sort();
		expect(names).toContain("source"); // neutral (refarm)
		expect(names).toContain("records"); // neutral (refarm)
		expect(names).toContain("vault"); // neutral (refarm)
		expect(names).toContain("requirements"); // work-specific (notesbox)
		expect(names).toContain("requirements-moc"); // product view (notesbox)
		expect(names).toContain("annotate"); // extension-path verb
		expect(names).toContain("status"); // host-provided operator surface
		expect(names).toContain("actions"); // host-provided surface actions
	});

	it("declares notesbox as a white-label capability host", () => {
		const host = buildNotesboxHost({ sourceCacheRoot });
		expect(host.program().name()).toBe("notesbox");
		expect(host.registry().list().map((entry) => entry.name)).toEqual(
			expect.arrayContaining([
				"source",
				"records",
				"vault",
				"requirements",
				"requirements-moc",
				"annotate",
				"status",
				"actions",
			]),
		);
		expect(host.baseModel()).toMatchObject({
			command: "notesbox",
			operation: "base",
			nextCommand: "notesbox requirements-moc --json",
		});
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"open-requirements-moc",
			"review-root-requirement",
		]);
	});

	it("`requirements` (the app verb) reports the app's own source + records", async () => {
		const reg = registry();
		const entry = reg.list().find((e) => e.name === "requirements");
		if (!entry || isCapabilityGroup(entry)) throw new Error("no requirements verb");
		const env = (await entry.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			sourceRef: string;
			recordCount: number;
		};
		expect(env.ok).toBe(true);
		expect(env.sourceRef).toBe(NOTESBOX_SOURCE_REF);
		expect(env.recordCount).toBe(2);
	});

	it("step 0 — `source discover` lists the work systems the analyst can access", async () => {
		const reg = registry();
		const found = await runGroup(reg, "source", ["discover"]);
		expect(found.ok).toBe(true);
		// The app's provider advertises BOTH work systems as its catalog — refarm ships
		// none of them; they're the app's data.
		expect(found.count).toBe(2);
		const refs = (found.sources as Array<{ ref: string }>).map((s) => s.ref);
		expect(refs).toEqual(
			expect.arrayContaining([NOTESBOX_SOURCE_REF, "web:notesbox-fiscal-records"]),
		);
	});

	it("step 1 — `source pull <app ref>` materializes the app's OWN fixture offline", async () => {
		const reg = registry();
		const pulled = await runGroup(reg, "source", ["pull", NOTESBOX_SOURCE_REF]);
		expect(pulled.ok).toBe(true);
		expect(pulled.offline).toBe(true);
		expect(pulled.action).toBe("cloned");

		const status = await runGroup(reg, "source", ["status", NOTESBOX_SOURCE_REF]);
		expect((status.status as { materialized: boolean }).materialized).toBe(true);
	});

	it("step 2 — `records enrich` enriches the app's manifest via the app's lookup", async () => {
		const reg = registry();
		const enriched = await runGroup(reg, "records", ["enrich"]);
		expect(enriched.ok).toBe(true);
		expect(enriched.mode).toBe("dry-run");
		// The app's enrichment fixture (REQ-1/REQ-2) changes both records.
		expect((enriched.changedRecordIds as string[]).length).toBe(2);
		expect((enriched.validation as { ok: boolean }).ok).toBe(true);
	});

	it("step 2b — `records correct <id> reviewed --apply` persists the analyst's review", async () => {
		const reg = registry();
		// The analyst marks a record reviewed and it PERSISTS via the app's injected sink.
		const corrected = await runGroup(reg, "records", [
			"correct",
			"record:req-root",
			"reviewed",
			"--apply",
		]);
		expect(corrected.ok).toBe(true);
		expect(corrected.mode).toBe("apply");
		expect(corrected.persisted).toBe(true);
		expect(corrected.writable).toBe(true); // the app injected a save sink
		expect(corrected.nextCommand).toBe("notesbox records list");
		expect(corrected.nextCommands).toEqual(["notesbox records list"]);

		// The correction is durable: a later `records list` on the SAME registry sees the
		// new review state (the sink wrote through; loadManifest reads it back).
		const listed = await runGroup(reg, "records", ["list"]);
		const rec = (listed.records as Array<{ id: string; reviewState: string }>).find(
			(r) => r.id === "record:req-root",
		);
		expect(rec?.reviewState).toBe("reviewed");
	});

	it("persists analyst corrections across separate notesbox CLI processes when state is configured", async () => {
		const statePath = path.join(tempDir("notesbox-state-"), "manifest.json");
		const corrected = await runGroup(
			createNotesboxRegistry({ sourceCacheRoot, statePath }),
			"records",
			["correct", "record:req-root", "reviewed", "--apply"],
		);
		expect(corrected.persisted).toBe(true);
		expect(corrected.nextCommand).toBe("notesbox records list");

		const env = await runGroup(
			createNotesboxRegistry({ sourceCacheRoot, statePath }),
			"records",
			["list"],
		);
		const rec = (env.records as Array<{ id: string; reviewState: string }>).find(
			(r) => r.id === "record:req-root",
		);
		expect(rec?.reviewState).toBe("reviewed");

		expect(buildNotesboxBaseModel({ sourceCacheRoot, statePath }).nextCommands).toEqual([
			"notesbox requirements-moc --json",
		]);
	});

	it("step 2c — `records analyze` returns a neutral grouping envelope (the analyst's MOC data)", async () => {
		const reg = registry();
		// The T3 analyst persona projects this envelope into a requirements-analysis MOC;
		// refarm ships only the neutral grouping engine, the app decides the view.
		const analyzed = await runGroup(reg, "records", ["analyze", "--by", "reviewState"]);
		expect(analyzed.ok).toBe(true);
		expect((analyzed.summary as { total: number }).total).toBe(2);
		const groups = analyzed.groups as Array<{ key: string; records: unknown[] }>;
		// Two records, one per review state → two navigable groups the MOC lists.
		expect(groups.map((g) => g.key).sort()).toEqual(["draft", "reviewed"]);
	});

	it("step 3 — `vault init` seeds the app's records into REAL Obsidian markdown", async () => {
		const reg = registry();
		const vaultDir = path.join(tempDir("notesbox-vault-"), "vault");
		const init = await runGroup(reg, "vault", ["init", vaultDir]);
		expect(init.ok).toBe(true);
		expect(init.seededCount).toBe(2); // the app injected a 2-record seed

		// The seeded files round-trip back into KnowledgeRecords — a vault IS markdown.
		const files = init.seededFiles as string[];
		expect(files.length).toBe(2);
		const markdown = fs.readFileSync(path.join(vaultDir, files[0] as string), "utf-8");
		expect(markdown.startsWith("---\n")).toBe(true);
		const { record } = parseRecordsYamlLdFrontMatter(markdown);
		expect(record["@type"]).toContain("KnowledgeRecord");
	});

	it("the whole flow runs off ONE registry — proving neutral blocks are reusable", async () => {
		const reg = registry();
		// discover → source pull → records enrich → vault init, all through the same
		// composed registry, no refarm-side work vocabulary involved.
		const found = await runGroup(reg, "source", ["discover"]);
		expect(found.count).toBe(2);
		await runGroup(reg, "source", ["pull", NOTESBOX_SOURCE_REF]);
		const enriched = await runGroup(reg, "records", ["enrich"]);
		const vaultDir = path.join(tempDir("notesbox-vault2-"), "vault");
		const init = await runGroup(reg, "vault", ["init", vaultDir]);
		expect(enriched.ok && init.ok).toBe(true);
	});
});
