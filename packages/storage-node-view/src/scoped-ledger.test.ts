import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import { createNodeFsStorageProvider } from "@refarm.dev/storage-fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	openScopedLedger,
	openScopedLedgerLayers,
	readLayeredNode,
	scopedLedgerPath,
} from "./scoped-ledger.js";

function node(id: string, extra: Record<string, unknown> = {}): NormalisedNode {
	return { "@id": id, "@type": "refarm:test", ...extra } as NormalisedNode;
}

describe("openScopedLedger (host bootstrap for durable node-ledgers)", () => {
	let userHome: string;
	let workspaceRoot: string;

	beforeEach(() => {
		userHome = mkdtempSync(join(tmpdir(), "snv-user-"));
		workspaceRoot = mkdtempSync(join(tmpdir(), "snv-ws-"));
	});
	afterEach(() => {
		rmSync(userHome, { recursive: true, force: true });
		rmSync(workspaceRoot, { recursive: true, force: true });
	});

	it("resolves the scoped store path under <scope>/.refarm/<name>/ledger.json", () => {
		expect(scopedLedgerPath("scheduler", "workspace", { workspaceRoot })).toBe(
			join(workspaceRoot, ".refarm", "scheduler", "ledger.json"),
		);
		expect(scopedLedgerPath("scheduler", "user", { userHome })).toBe(
			join(userHome, ".refarm", "scheduler", "ledger.json"),
		);
	});

	it("opening does not touch disk; the first write creates the store lazily", async () => {
		const ledger = openScopedLedger("scheduler", "workspace", { workspaceRoot });
		const path = scopedLedgerPath("scheduler", "workspace", { workspaceRoot });
		expect(() => readFileSync(path)).toThrow(); // nothing yet

		await ledger.storeNode(node("fire:2026-07-04", { firedAt: "now" }));
		expect(readFileSync(path, "utf8")).toContain("fire:2026-07-04");
	});

	it("round-trips a node through the fs-backed scoped ledger", async () => {
		const ledger = openScopedLedger("scheduler", "workspace", { workspaceRoot });
		await ledger.storeNode(node("fire:job-a", { receipt: "ok" }));

		const read = await ledger.getNode("fire:job-a");
		expect(read).not.toBeNull();
		expect(read?.["@id"]).toBe("fire:job-a");
		expect((read as Record<string, unknown>).receipt).toBe("ok");
		expect(await ledger.getNode("fire:absent")).toBeNull();
	});

	it("one file, two faces: the scoped ledger's bytes are a plain record store", async () => {
		const ledger = openScopedLedger("scheduler", "workspace", { workspaceRoot });
		await ledger.storeNode(node("fire:x"));

		// The SAME path, read as flat records via the raw provider, sees the node.
		const path = scopedLedgerPath("scheduler", "workspace", { workspaceRoot });
		const records = createNodeFsStorageProvider(path);
		expect(await records.get("fire:x")).not.toBeNull();
	});

	it("layers open user then workspace in apply order (lowest precedence first)", () => {
		const layers = openScopedLedgerLayers("config", { userHome, workspaceRoot });
		expect(layers.map((l) => l.scope)).toEqual(["user", "workspace"]);
		expect(layers[0]!.path).toBe(
			join(userHome, ".refarm", "config", "ledger.json"),
		);
		expect(layers[1]!.path).toBe(
			join(workspaceRoot, ".refarm", "config", "ledger.json"),
		);
	});

	it("readLayeredNode: workspace overrides user for the same id; base shows through", async () => {
		const layers = openScopedLedgerLayers("config", { userHome, workspaceRoot });
		const [user, workspace] = layers;

		await user!.ledger.storeNode(node("model", { ref: "user-default" }));
		await user!.ledger.storeNode(node("theme", { ref: "user-theme" }));
		await workspace!.ledger.storeNode(node("model", { ref: "workspace-override" }));

		// Overridden id resolves to the workspace layer...
		const model = await readLayeredNode(layers, "model");
		expect((model as Record<string, unknown>).ref).toBe("workspace-override");
		// ...while an id only the user layer set still shows through.
		const theme = await readLayeredNode(layers, "theme");
		expect((theme as Record<string, unknown>).ref).toBe("user-theme");
		// An unknown id is null across all layers.
		expect(await readLayeredNode(layers, "absent")).toBeNull();
	});
});
