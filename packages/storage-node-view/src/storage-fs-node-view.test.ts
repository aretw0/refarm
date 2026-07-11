import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodeFsStorageProvider } from "@refarm.dev/storage-fs";
import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeView } from "./node-view.js";

/**
 * THE PAYOFF: one storage-fs JSON file, two faces.
 *
 * Prove that an unchanged NodeFsStorageProvider (a plain record ledger) ALSO
 * serves typed nodes when wrapped in a NodeView — same bytes, read back both as
 * a ledger StorageRecord and as a typed node. This is the operational proof of
 * "a ledger is just a set of nodes". No SQL, no CRDT, no Rust — pure record/fs
 * side of the ADR-059 boundary.
 */
describe("storage-fs serves ledger records AND nodes", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "refarm-node-view-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("stores a Task node, reads it back as a node AND as a ledger record", async () => {
		const provider = createNodeFsStorageProvider(join(dir, "store.json"));
		const view = createNodeView(provider, {
			now: () => "2026-07-03T00:00:00.000Z",
		});

		const task: NormalisedNode = {
			"@context": "https://schema.org/",
			"@type": "Task",
			"@id": "urn:sovereign:agent:task-42",
			"sourcePlugin": "agent",
			title: "Ship the node view",
			priority: 2,
		};

		await view.storeNode(task);

		// Face 1 — as a typed node (schema-on-read).
		const node = await view.getNode("urn:sovereign:agent:task-42");
		expect(node?.["@type"]).toBe("Task");
		expect(node?.title).toBe("Ship the node view");
		expect(node?.["sourcePlugin"]).toBe("agent");

		// Face 2 — the SAME bytes as a plain ledger StorageRecord.
		const record = await provider.get("urn:sovereign:agent:task-42");
		expect(record?.id).toBe("urn:sovereign:agent:task-42");
		expect(record?.type).toBe("Task");
		// The node body is carried losslessly in the record payload.
		expect(JSON.parse(record!.payload).title).toBe("Ship the node view");
	});

	it("queries nodes by @type through the same provider", async () => {
		const provider = createNodeFsStorageProvider(join(dir, "q.json"));
		const view = createNodeView(provider, {
			now: () => "2026-07-03T00:00:00.000Z",
		});

		await view.storeNode({
			"@context": "https://schema.org/",
			"@type": "PluginCatalogEntry",
			"@id": "urn:sovereign:plugin:a",
		});
		await view.storeNode({
			"@context": "https://schema.org/",
			"@type": "PluginCatalogEntry",
			"@id": "urn:sovereign:plugin:b",
		});
		await view.storeNode({
			"@context": "https://schema.org/",
			"@type": "ConfigOverride",
			"@id": "urn:sovereign:config:x",
		});

		const plugins = await view.queryNodes("PluginCatalogEntry");
		expect(plugins.map((n) => n["@id"]).sort()).toEqual([
			"urn:sovereign:plugin:a",
			"urn:sovereign:plugin:b",
		]);
	});
});
