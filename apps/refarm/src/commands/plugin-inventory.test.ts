import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readInstalledPlugins } from "./plugin-inventory.js";

/**
 * MEASURED on the operator's node 2026-08-25: FOUR installed trees, and `refarm plugin list`
 * reported ONE under every `--origin` filter, while `plugin status` reported the two that
 * loaded. Between them, an installed-but-unloaded tree was invisible on every surface.
 *
 * The real node also proved TWO layouts, not one: `refarm_agent/` (flat) alongside
 * `@refarm/agent/` (the pre-convergence npm-scope nesting `legacyScopedPluginWasmPath`
 * still names), and the SAME manifest id — `@refarm/agent` — installed under both. The tests
 * below cover both layouts explicitly and assert the shared id is never collapsed.
 */
describe("what is installed here, and does each tree hash to what it claims", () => {
	function tree(base: string, dirName: string, id: string, bytes: string, declared: string | null) {
		const dir = path.join(base, dirName);
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, "plugin.wasm"), bytes);
		writeFileSync(
			path.join(dir, "plugin.json"),
			JSON.stringify({ id, ...(declared ? { integrity: declared } : {}) }),
		);
	}

	it("lists a tree that is installed and NOT loaded — the state that had no surface", () => {
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_ghost", "@refarm/ghost", "bytes", null);

		expect(readInstalledPlugins(base).map((p) => p.manifestId)).toEqual(["@refarm/ghost"]);
	});

	it("reports a declared hash that does not match, without dropping the tree", () => {
		// The operator's own node carried `sha256-000000…` against real bytes. A listing that
		// omitted it would hide 476KB of executable from the only surface that could name it.
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_stale", "@refarm/stale", "bytes", "sha256-0000000000");

		const [entry] = readInstalledPlugins(base);
		expect(entry?.integrity).toBe("mismatch");
	});

	it("distinguishes an ABSENT claim from a wrong one", () => {
		// D3 rests on this distinction: absent means "unsigned, possibly under development";
		// wrong means "tampered or replaced". Collapsing them is what made the operator's stale
		// tree ambiguous.
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_dev", "@refarm/dev", "bytes", null);

		expect(readInstalledPlugins(base)[0]?.integrity).toBe("absent");
	});

	it("projects both id vocabularies, since three spellings are live", () => {
		// `plugin:tem` crosses every projection unreduced. `plugin permissions` needs the
		// manifest id and no listing surface published it (measured 2026-08-25).
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_lsp-code-ops", "@refarm/lsp-code-ops", "bytes", null);

		const [entry] = readInstalledPlugins(base);
		expect(entry?.manifestId).toBe("@refarm/lsp-code-ops");
		expect(entry?.runtimeId).toBe("lsp-code-ops");
	});

	it("finds a tree under the FLAT layout — <baseDir>/<fsToken>/plugin.json", () => {
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_agent", "@refarm/agent", "bytes", null);

		const [entry] = readInstalledPlugins(base);
		expect(entry?.manifestId).toBe("@refarm/agent");
		expect(entry?.dir).toBe(path.join(base, "refarm_agent"));
	});

	it("finds a tree under the NESTED npm-scope layout — <baseDir>/@scope/name/plugin.json", () => {
		// `legacyScopedPluginWasmPath` (plugin-install-path.ts) names this layout as the
		// pre-convergence one; nothing writes it anymore, but it is still on disk.
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, path.join("@refarm", "pi-agent"), "@refarm/pi-agent", "bytes", null);

		const [entry] = readInstalledPlugins(base);
		expect(entry?.manifestId).toBe("@refarm/pi-agent");
		expect(entry?.dir).toBe(path.join(base, "@refarm", "pi-agent"));
	});

	it("does not descend past one extra level under a scope directory", () => {
		// Descent under `@scope/` is bounded to exactly one level, not a general recursive
		// walk — an unbounded walk under a directory of executables is a larger and different
		// promise than this scan makes.
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, path.join("@refarm", "nested", "too-deep"), "@refarm/too-deep", "bytes", null);

		expect(readInstalledPlugins(base)).toEqual([]);
	});

	it("keeps BOTH trees when two directories share one manifest id — never deduped", () => {
		// Measured on the operator's node: `@refarm/agent` exists flat AND nested. The
		// duplication is the finding this scan exists to surface; collapsing it by id would
		// hide exactly what the operator cannot currently see.
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_agent", "@refarm/agent", "flat-bytes", null);
		tree(base, path.join("@refarm", "agent"), "@refarm/agent", "nested-bytes", "sha256-0000000000");

		const found = readInstalledPlugins(base);
		expect(found).toHaveLength(2);
		expect(found.every((p) => p.manifestId === "@refarm/agent")).toBe(true);
		expect(new Set(found.map((p) => p.dir))).toEqual(
			new Set([path.join(base, "refarm_agent"), path.join(base, "@refarm", "agent")]),
		);
		// keyed by dir, not id: the flat copy is unsigned (absent), the nested one is a
		// tampered/wrong claim (mismatch) — collapsing them would have hidden this split.
		const byDir = Object.fromEntries(found.map((p) => [p.dir, p.integrity]));
		expect(byDir[path.join(base, "refarm_agent")]).toBe("absent");
		expect(byDir[path.join(base, "@refarm", "agent")]).toBe("mismatch");
	});

	it("a missing plugin.wasm beside a declared hash is a mismatch, not absent", () => {
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		const dir = path.join(base, "refarm_headless");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			path.join(dir, "plugin.json"),
			JSON.stringify({ id: "@refarm/headless", integrity: "sha256-abc123" }),
		);
		// deliberately no plugin.wasm written

		expect(readInstalledPlugins(base)[0]?.integrity).toBe("mismatch");
	});

	it("skips a tree whose manifest is unreadable, rather than inventing a name for it", () => {
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		const dir = path.join(base, "refarm_broken");
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, "plugin.wasm"), "bytes");
		writeFileSync(path.join(dir, "plugin.json"), "{ not valid json");

		expect(readInstalledPlugins(base)).toEqual([]);
	});
});
