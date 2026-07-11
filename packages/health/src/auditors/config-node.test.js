import { createConfigNode } from "@refarm.dev/config";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigNodeAuditor } from "./config-node.js";

/** A minimal fake graphContext returning a fixed node for CONFIG_NODE_DEFAULT_ID. */
function fakeGraph(node) {
	return {
		async getNode(id) {
			return id === "urn:sovereign:config:workspace" ? node : null;
		},
	};
}

describe("ConfigNodeAuditor", () => {
	let root;

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), "config-node-audit-"));
		mkdirSync(path.join(root, ".refarm"), { recursive: true });
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function writeLocalConfig(config) {
		writeFileSync(path.join(root, ".refarm", "config.json"), JSON.stringify(config));
	}

	it("reports NO drift when the graph node matches the raw local config", async () => {
		const config = { provider: "ollama", budgets: { anthropic: 5 } };
		writeLocalConfig(config);
		// The stored node is what the host would have written from the same raw file.
		const node = createConfigNode(config);

		const result = await new ConfigNodeAuditor({
			graphContext: fakeGraph(node),
		}).audit({ rootDir: root });

		expect(result.issues).toEqual([]);
		expect(result.note).toContain("in sync");
	});

	it("does NOT false-drift on a secret-bearing config (redaction parity)", async () => {
		// The node stored the REDACTED config; the raw local file has the secret.
		// createConfigNode redacts internally on both sides, so revisions match.
		const config = { provider: "openai", openaiApiKey: "sk-secret-123" };
		writeLocalConfig(config);
		const node = createConfigNode(config);

		const result = await new ConfigNodeAuditor({
			graphContext: fakeGraph(node),
		}).audit({ rootDir: root });

		expect(result.issues).toEqual([]);
	});

	it("does NOT false-drift when node and local differ ONLY in device-local fields", async () => {
		// Device B's local file carries device-global config identical to the node device A
		// wrote, plus B's own machine-specific fields (a different sidecarUrl, engine,
		// autostart). Those are stripped before hashing on both sides, so the portable
		// projections match and there is NO drift. This is the cross-device fix.
		writeLocalConfig({
			provider: "ollama",
			budgets: { anthropic: 5 },
			runtime: { sidecarUrl: "http://127.0.0.1:47777" },
			tractor: { engine: "ts" },
			autostart: "never",
		});
		// The node as device A wrote it — same device-global config, A's own device-local.
		const node = createConfigNode({
			provider: "ollama",
			budgets: { anthropic: 5 },
			runtime: { sidecarUrl: "http://127.0.0.1:42001" },
			tractor: { engine: "rust" },
			autostart: "always",
		});

		const result = await new ConfigNodeAuditor({
			graphContext: fakeGraph(node),
		}).audit({ rootDir: root });

		expect(result.issues).toEqual([]);
		expect(result.note).toContain("in sync");
	});

	it("STILL detects drift on a real device-global difference (device-local strip is not a blindfold)", async () => {
		// Same device-local noise as above, but a genuine device-GLOBAL divergence
		// (different model) must still fire — the strip must not mask real drift.
		writeLocalConfig({
			model: "gpt-4",
			runtime: { sidecarUrl: "http://127.0.0.1:47777" },
		});
		const node = createConfigNode({
			model: "claude-opus", // ← genuine device-global divergence
			runtime: { sidecarUrl: "http://127.0.0.1:42001" },
		});

		const result = await new ConfigNodeAuditor({
			graphContext: fakeGraph(node),
		}).audit({ rootDir: root });

		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].type).toBe("config_node_drift");
	});

	it("detects drift when the graph node revision differs from local", async () => {
		writeLocalConfig({ provider: "ollama" });
		// Node was built from a DIFFERENT config (another device changed it).
		const node = createConfigNode({ provider: "anthropic" });

		const result = await new ConfigNodeAuditor({
			graphContext: fakeGraph(node),
		}).audit({ rootDir: root });

		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].type).toBe("config_node_drift");
		expect(result.issues[0].path).toBe("urn:sovereign:config:workspace");
	});

	it("no-ops informatively when there is no graphContext", async () => {
		writeLocalConfig({ provider: "ollama" });
		const result = await new ConfigNodeAuditor({}).audit({ rootDir: root });
		expect(result.issues).toEqual([]);
		expect(result.note).toContain("no graph store");
	});

	it("no-ops when the graph has no RefarmConfig node yet (fresh store)", async () => {
		writeLocalConfig({ provider: "ollama" });
		const result = await new ConfigNodeAuditor({
			graphContext: fakeGraph(null),
		}).audit({ rootDir: root });
		expect(result.issues).toEqual([]);
		expect(result.note).toContain("fresh store");
	});

	it("flags a malformed stored node", async () => {
		writeLocalConfig({ provider: "ollama" });
		const result = await new ConfigNodeAuditor({
			graphContext: fakeGraph({ schema: "wrong", kind: "wrong", data: {} }),
		}).audit({ rootDir: root });
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].type).toBe("config_node_invalid");
	});
});
