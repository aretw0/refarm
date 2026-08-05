import { describe, expect, it } from "vitest";
import type { NodeContextMetadata } from "../utils/context-metadata.js";
import { CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC } from "./context-doctor.js";
import {
	buildContextReport,
	resolveBuiltPluginPath,
	resolveOtherSovereignDirs,
	type ContextInput,
} from "./context.js";

// `metadata` is exactly what `resolveNodeContextMetadata` (../utils/context-metadata.js)
// already computes — `mode`, `binding.origin` (how the home was chosen), `sovereignHome`,
// `credentialStoreHome`, and `homesAligned`. This module does not invent a second name for
// any of it (see task-3-report.md correction (a)): it is reused verbatim and only the
// fields it does NOT carry — the node's identity, the loaded/built plugin, other sovereign
// dirs on disk — are added.
const METADATA: NodeContextMetadata = {
	mode: "node",
	binding: { kind: "detached", origin: "explicit" },
	state: { policy: "node-owned", homeRef: "/home/op/.refarm" },
	credentials: { policy: "node", storeRef: "/home/op/.silo" },
	runtime: { policy: "node" },
	sovereignHome: "/home/op/.refarm",
	credentialStoreHome: "/home/op/.silo",
	homesAligned: true,
};

const BASE: ContextInput = {
	metadata: METADATA,
	base: "/home/op",
	baseOrigin: "SOVEREIGN_BASE",
	namespace: "default",
	runtimeEndpoint: "http://127.0.0.1:42001",
	node: { name: "sede", id: "abc123def456", pid: 2025451, startedAt: "2026-08-05T17:28:00Z" },
	loadedPlugin: { path: "/home/op/.refarm/plugins/refarm_agent/plugin.wasm", sha256: "22dbabbd" },
	builtPluginPath: "/repo/packages/agent/dist/agent.wasm",
	builtPluginSha: "22dbabbd",
	otherSovereignDirs: [],
};

describe("buildContextReport", () => {
	it("names the mode, the home, and HOW the home was chosen — reusing resolveNodeContextMetadata's own vocabulary", () => {
		const r = buildContextReport(BASE);
		expect(r.metadata.mode).toBe("node");
		expect(r.metadata.sovereignHome).toBe("/home/op/.refarm");
		expect(r.metadata.binding.origin).toBe("explicit");
	});

	it("carries the namespace and runtime endpoint through untouched", () => {
		const r = buildContextReport(BASE);
		expect(r.namespace).toBe("default");
		expect(r.runtimeEndpoint).toBe("http://127.0.0.1:42001");
	});

	it("is silent when the loaded plugin matches the built one", () => {
		expect(buildContextReport(BASE).divergences).toEqual([]);
	});

	it("reports a hash mismatch — the case a path comparison would call fine", () => {
		const r = buildContextReport({ ...BASE, builtPluginSha: "68af329e" });
		expect(r.divergences.map((d) => d.kind)).toContain("plugin-hash-mismatch");
	});

	it("reports a sovereign dir that exists and is loaded by nothing", () => {
		const r = buildContextReport({ ...BASE, otherSovereignDirs: ["/repo/.refarm"] });
		expect(r.divergences.map((d) => d.kind)).toContain("unloaded-sovereign-dir");
	});

	it("an unhashable loaded plugin is UNKNOWN, never a match and never a mismatch", () => {
		const r = buildContextReport({
			...BASE,
			loadedPlugin: { path: "/x.wasm", sha256: null, unreadableReason: "could not read" },
		});
		expect(r.divergences.map((d) => d.kind)).toContain("plugin-hash-unknown");
		expect(r.divergences.map((d) => d.kind)).not.toContain("plugin-hash-mismatch");
	});

	it("a node that is not running yields no plugin divergence at all, not a false clean", () => {
		const r = buildContextReport({ ...BASE, node: null, loadedPlugin: null });
		expect(r.divergences.map((d) => d.kind)).toContain("node-not-running");
		expect(r.divergences.map((d) => d.kind)).not.toContain("plugin-hash-unknown");
		expect(r.divergences.map((d) => d.kind)).not.toContain("plugin-hash-mismatch");
	});

	it("a running node that names no plugin at all is UNKNOWN too — not silently clean", () => {
		const r = buildContextReport({ ...BASE, loadedPlugin: null });
		expect(r.divergences.map((d) => d.kind)).toContain("plugin-hash-unknown");
		expect(r.divergences.map((d) => d.kind)).not.toContain("node-not-running");
	});

	// CRITICAL fix (review round 1): an unresolvable or unreadable BUILT plugin must not be
	// silently read as a match. This is the exact live defect a reviewer reproduced running
	// `refarm context` outside the repository: builtPluginSha lands at null, and the old
	// `input.builtPluginSha &&` guard dropped the whole comparison rather than reporting it.
	it("an unhashable/unresolvable BUILT plugin is UNKNOWN too — never silently a match, mirroring the loaded side", () => {
		const r = buildContextReport({ ...BASE, builtPluginSha: null });
		expect(r.divergences.map((d) => d.kind)).toContain("built-plugin-unknown");
		expect(r.divergences.map((d) => d.kind)).not.toContain("plugin-hash-mismatch");
		expect(r.divergences).not.toEqual([]);
	});

	it("built-plugin-unknown fires the same way when builtPluginPath itself is null (no monorepo root found)", () => {
		const r = buildContextReport({ ...BASE, builtPluginPath: null, builtPluginSha: null });
		expect(r.divergences.map((d) => d.kind)).toContain("built-plugin-unknown");
	});

	// The sixth divergence kind the brief omitted (correction (b)): ADR-094's H3 verbatim —
	// the Silo credential home disagreeing with the Refarm sovereign home is a bug or a
	// declared divergence, not an implementation detail. `resolveNodeContextMetadata`
	// already computes this as `homesAligned`; this is the first place it becomes a
	// reported finding rather than a silent boolean.
	//
	// Review round 1: this divergence's `kind` is now derived from `context-doctor.ts`'s
	// exported `CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC` rather than a second, independently
	// invented name — this test asserts the two agree BY CONSTRUCTION (same imported
	// constant on both sides of the assertion).
	it("reports the sovereign home and the credential home disagreeing, under the SAME name doctor uses", () => {
		const r = buildContextReport({
			...BASE,
			metadata: { ...METADATA, credentialStoreHome: "/home/op/.silo-other", homesAligned: false },
		});
		expect(r.divergences.map((d) => d.kind)).toContain(CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC);
	});

	it("is silent about credential homes when they align", () => {
		const r = buildContextReport(BASE);
		expect(r.divergences.map((d) => d.kind)).not.toContain(CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC);
	});
});

describe("resolveBuiltPluginPath", () => {
	it("joins packages/agent/dist/agent.wasm under a root that carries a real monorepo marker", () => {
		expect(resolveBuiltPluginPath("/repo", () => true)).toBe(
			"/repo/packages/agent/dist/agent.wasm",
		);
	});

	// This is the CRITICAL fix itself, isolated: `findWorkspaceRoot` falls back to
	// returning `cwd` verbatim when it finds no `.git` / `pnpm-workspace.yaml` / workspaces
	// `package.json` anywhere above it — the NORMAL case for an operator standing outside
	// the monorepo. Trusting that fallback used to fabricate
	// `<cwd>/packages/agent/dist/agent.wasm`, a path that never existed.
	it("is null when the root carries no monorepo marker — never a fabricated path", () => {
		expect(resolveBuiltPluginPath("/home/operator", () => false)).toBeNull();
	});
});

describe("resolveOtherSovereignDirs", () => {
	it("reports a candidate that exists and is not the active home", () => {
		const dirs = resolveOtherSovereignDirs(
			"/home/op/.refarm",
			["/repo/.refarm"],
			(p) => p === "/repo/.refarm",
		);
		expect(dirs).toEqual(["/repo/.refarm"]);
	});

	it("stays silent about the active home even if it is also passed as a candidate", () => {
		const dirs = resolveOtherSovereignDirs("/home/op/.refarm", ["/home/op/.refarm"], () => true);
		expect(dirs).toEqual([]);
	});

	it("stays silent about a candidate that does not exist on disk", () => {
		const dirs = resolveOtherSovereignDirs("/home/op/.refarm", ["/repo/.refarm"], () => false);
		expect(dirs).toEqual([]);
	});

	// The MINOR fix: this must see an abandoned home on EITHER side of the mode split — a
	// workspace-scoped `.refarm` sitting unloaded while `node` mode is active, or the
	// node-global default sitting unloaded while `workspace` mode is active.
	it("checks both the workspace-scoped and the node-global candidate, whichever side is not active", () => {
		const dirs = resolveOtherSovereignDirs(
			"/home/op/.refarm", // active: node-global
			["/repo/.refarm", "/home/op/.refarm"],
			() => true,
		);
		expect(dirs).toEqual(["/repo/.refarm"]);
	});

	it("de-duplicates candidates that resolve to the same directory", () => {
		const dirs = resolveOtherSovereignDirs(
			"/home/op/.refarm",
			["/repo/.refarm", "/repo/.refarm"],
			() => true,
		);
		expect(dirs).toEqual(["/repo/.refarm"]);
	});
});
