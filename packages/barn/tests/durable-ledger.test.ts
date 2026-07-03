import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodeFsStorageProvider } from "@refarm.dev/storage-fs";
import { createNodeView } from "@refarm.dev/storage-node-view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Barn } from "../src/index";

async function sha256IntegrityFor(content: string): Promise<string> {
	const bytes = new TextEncoder().encode(content);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256-${Buffer.from(new Uint8Array(digest)).toString("base64")}`;
}

function mockFetchReturning(content: string): void {
	vi.mocked(global.fetch).mockResolvedValue({
		ok: true,
		statusText: "OK",
		arrayBuffer: async () => new TextEncoder().encode(content).buffer,
	} as unknown as Response);
}

/**
 * Closes the T-PLUGIN-01 audit gap: the Barn install inventory was
 * process-local (in-memory Map, lost on restart). With a node-graph ledger
 * injected (NodeView over storage-fs), the install record IS a node persisted
 * to disk — a fresh Barn reads the same inventory back. The Barn never names a
 * backend; the host injects the ledger.
 */
describe("Barn durable install-ledger (via injected NodeView)", () => {
	let dir: string;
	let ledgerPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "refarm-barn-ledger-"));
		ledgerPath = join(dir, "barn", "inventory.json");
		global.fetch = vi.fn();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	function barnWithFsLedger(): Barn {
		const ledger = createNodeView(createNodeFsStorageProvider(ledgerPath));
		return new Barn({ ledger });
	}

	it("persists an install record to disk and reads it back from a NEW Barn", async () => {
		const url = "http://localhost:8080/durable-plugin.wasm";
		const integrity = await sha256IntegrityFor("durable content");
		mockFetchReturning("durable content");

		const first = barnWithFsLedger();
		const entry = await first.installPlugin(url, integrity);
		expect(entry.status).toBe("installed");

		// A brand-new Barn instance over the SAME ledger file — no shared memory.
		const second = barnWithFsLedger();
		const inventory = await second.listPlugins();
		expect(inventory).toHaveLength(1);
		expect(inventory[0]?.id).toBe(entry.id);
		expect(inventory[0]?.url).toBe(url);
		expect(inventory[0]?.integrity).toBe(integrity);
		expect(inventory[0]?.status).toBe("installed");
		expect(inventory[0]?.wasmHash).toBe(entry.wasmHash);
	});

	it("uninstall removes the record durably (new Barn sees it gone)", async () => {
		const url = "http://localhost:8080/tmp-plugin.wasm";
		const integrity = await sha256IntegrityFor("tmp content");
		mockFetchReturning("tmp content");

		const first = barnWithFsLedger();
		const entry = await first.installPlugin(url, integrity);
		await first.uninstallPlugin(entry.id);

		const second = barnWithFsLedger();
		expect(await second.listPlugins()).toHaveLength(0);
	});

	it("still works fully in-memory when no ledger is injected (legacy)", async () => {
		const url = "http://localhost:8080/mem-plugin.wasm";
		const integrity = await sha256IntegrityFor("mem content");
		mockFetchReturning("mem content");

		const barn = new Barn();
		const entry = await barn.installPlugin(url, integrity);
		expect((await barn.listPlugins())[0]?.id).toBe(entry.id);

		// A different in-memory Barn shares nothing.
		expect(await new Barn().listPlugins()).toHaveLength(0);
	});
});
