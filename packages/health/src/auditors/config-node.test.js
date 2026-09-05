import { createConfigNode } from "@refarm.dev/config";

// The substrate has no config-dir default; the app injects SOVEREIGN_DIR. This
// test stands in for the app, selecting ".refarm".
process.env.SOVEREIGN_DIR ||= ".refarm";
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

	describe("scope parity: configBase vs. an unrelated rootDir (two roots, one node)", () => {
		// Regression coverage for the real defect: the graph half always answers from
		// whichever daemon actually owns the node — a fixed scope, NOT `rootDir`/cwd.
		// `context.rootDir` here stands in for "wherever the CLI happens to be invoked
		// from" (e.g. a repository checkout with its own leftover project-local sandbox
		// `.refarm/config.json`); `context.configBase` stands in for the SEPARATE,
		// correctly-resolved scope the graph node's owning daemon actually used (e.g.
		// the operator's home). The two roots carry DIFFERENT config on purpose, so a
		// regression that makes the auditor read the local half from `rootDir` (or
		// `process.cwd()`) instead of `configBase` fails these tests immediately —
		// it would pick up the wrong root's config and get the wrong answer.
		let nodeRoot;
		let unrelatedRoot;

		beforeEach(() => {
			nodeRoot = mkdtempSync(path.join(tmpdir(), "config-node-audit-node-"));
			mkdirSync(path.join(nodeRoot, ".refarm"), { recursive: true });
			unrelatedRoot = mkdtempSync(path.join(tmpdir(), "config-node-audit-unrelated-"));
			mkdirSync(path.join(unrelatedRoot, ".refarm"), { recursive: true });
		});
		afterEach(() => {
			rmSync(nodeRoot, { recursive: true, force: true });
			rmSync(unrelatedRoot, { recursive: true, force: true });
		});

		function writeConfigAt(base, config) {
			writeFileSync(path.join(base, ".refarm", "config.json"), JSON.stringify(config));
		}

		it("reports NO drift when configBase matches the node, even though rootDir carries a wholly different config", async () => {
			const nodeConfig = { provider: "ollama", budgets: { anthropic: 5 } };
			writeConfigAt(nodeRoot, nodeConfig);
			// A genuinely different config at the unrelated root — mirrors a repo-local
			// sandbox `.refarm/config.json` left over from dev/testing (VPN connections,
			// trusted_plugins, no delivery/processes — the exact shape of the diagnosed
			// false positive).
			writeConfigAt(unrelatedRoot, {
				provider: "anthropic",
				connections: { "ovpn-serpro": { type: "vpn" } },
				trusted_plugins: ["some-plugin"],
			});
			// The node as the OWNING daemon (rooted at nodeRoot) actually published it.
			const node = createConfigNode(nodeConfig);

			const result = await new ConfigNodeAuditor({ graphContext: fakeGraph(node) }).audit({
				rootDir: unrelatedRoot,
				configBase: nodeRoot,
			});

			expect(result.issues).toEqual([]);
			expect(result.note).toContain("in sync");
		});

		it("still fires config_node_drift on a genuine mismatch at configBase, not masked by rootDir happening to agree", async () => {
			// rootDir's file is IDENTICAL to the node on purpose — proves a clean
			// result can only come from configBase agreeing, never from rootDir.
			const sharedConfig = { provider: "ollama" };
			writeConfigAt(unrelatedRoot, sharedConfig);
			// configBase's own file genuinely diverges from what the node holds.
			writeConfigAt(nodeRoot, { provider: "ollama", model: "local-only-edit" });
			const node = createConfigNode(sharedConfig);

			const result = await new ConfigNodeAuditor({ graphContext: fakeGraph(node) }).audit({
				rootDir: unrelatedRoot,
				configBase: nodeRoot,
			});

			expect(result.issues).toHaveLength(1);
			expect(result.issues[0].type).toBe("config_node_drift");
		});
	});

	it("reports a real issue — not a skipped note — when the graph read throws", async () => {
		// This is the state that used to disappear: a graphContext EXISTS (the
		// substrate is present), but reading through it fails (e.g. the
		// sidecar-client rejecting a real node for missing @context, the exact
		// live defect this test guards against regressing). The old behaviour
		// returned `{ issues: [], note: "…skipped…" }` — byte-identical to a
		// clean pass to anything that only counts `issues.length`.
		writeLocalConfig({ provider: "ollama" });
		const throwingGraph = {
			async getNode() {
				throw new Error("sidecar graph response includes malformed node");
			},
		};

		const result = await new ConfigNodeAuditor({ graphContext: throwingGraph }).audit({
			rootDir: root,
		});

		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].type).toBe("config_node_unreachable");
		expect(result.issues[0].path).toBe("urn:sovereign:config:workspace");
		expect(result.issues[0].note).toContain("sidecar graph response includes malformed node");
		// No lingering top-level `note` masquerading as a clean-pass shape.
		expect(result.note).toBeUndefined();
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
