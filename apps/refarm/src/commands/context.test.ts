import { describe, expect, it } from "vitest";
import type { NodeContextMetadata } from "../utils/context-metadata.js";
import type { NodeEnvironment } from "../utils/node-environment.js";
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

// The node's SECONDARY witness (Task 1, `../utils/node-environment.ts`) — what a running
// node declares in its OWN `/proc/<pid>/environ`, not reconstructed from the CLI's
// `process.env`. Since the final fix wave (2026-08-06) this no longer supplies the base
// VALUE (`ContextNode.declarationBase` does — see below); it only answers whether that base
// was TOLD (`base` non-null here) or DERIVED (`base: null`) and is the sole witness for
// namespace. The `BASE` fixture below puts this in agreement with the CLI's own resolved
// values (`cliBase`/`cliNamespace`) so the "no divergence" tests stay a true baseline;
// individual tests override `nodeEnvironment` (or set it `null`) to construct a disagreement.
const NODE_ENVIRONMENT_AGREEING: NodeEnvironment = {
	base: "/home/op",
	sovereignDir: null,
	home: null,
	namespace: "default",
	cwd: "/home/op",
};

const BASE: ContextInput = {
	metadata: METADATA,
	cliBase: "/home/op",
	cliBaseOrigin: "SOVEREIGN_BASE",
	cliNamespace: "default",
	runtimeEndpoint: "http://127.0.0.1:42001",
	// `declarationBase` is the PRIMARY witness for the node's base since the final fix wave
	// (2026-08-06) — `node.json`, published by `main.rs` after the base is settled. Set here
	// to agree with `cliBase` for the same reason `NODE_ENVIRONMENT_AGREEING` does.
	node: {
		name: "sede",
		id: "abc123def456",
		pid: 2025451,
		startedAt: "2026-08-05T17:28:00Z",
		declarationBase: "/home/op",
	},
	nodeEnvironment: NODE_ENVIRONMENT_AGREEING,
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

	it("carries the CLI's own namespace and the runtime endpoint through untouched", () => {
		const r = buildContextReport(BASE);
		expect(r.cliNamespace).toBe("default");
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
		const r = buildContextReport({ ...BASE, node: null, loadedPlugin: null, nodeEnvironment: null });
		expect(r.divergences.map((d) => d.kind)).toContain("node-not-running");
		expect(r.divergences.map((d) => d.kind)).not.toContain("plugin-hash-unknown");
		expect(r.divergences.map((d) => d.kind)).not.toContain("plugin-hash-mismatch");
	});

	// Unchanged behavior, made explicit for the environment comparison too (brief step 1,
	// 5th case): no running node means nothing to compare base/namespace against, so this
	// must stay silent on base-divergence/namespace-divergence/node-environment-unknown —
	// `node-not-running` is the whole story, not a second finding layered on top of it.
	it("a node that is not running yields no environment divergence either — node-not-running is the whole story", () => {
		const r = buildContextReport({ ...BASE, node: null, loadedPlugin: null, nodeEnvironment: null });
		const kinds = r.divergences.map((d) => d.kind);
		expect(kinds).toContain("node-not-running");
		expect(kinds).not.toContain("base-divergence");
		expect(kinds).not.toContain("namespace-divergence");
		expect(kinds).not.toContain("node-environment-unknown");
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

	// The defect this task exists to close: `refarm context`'s `base:` line read as the
	// node's but was the CLI's. `BASE` puts the node and the CLI in agreement; each test
	// below moves exactly one side to construct a real disagreement.
	describe("node vs CLI: base and namespace", () => {
		it("is silent when the node and the CLI agree on both base and namespace", () => {
			const r = buildContextReport(BASE);
			const kinds = r.divergences.map((d) => d.kind);
			expect(kinds).not.toContain("base-divergence");
			expect(kinds).not.toContain("namespace-divergence");
			expect(kinds).not.toContain("node-environment-unknown");
		});

		// The live defect, reproduced: the node's descriptor names one base, the CLI resolves
		// another. The summary must name BOTH values — an operator staring at one path alone
		// cannot tell which side is which. `nodeEnvironment.base` here is the "told" case —
		// present only to prove the origin annotation reads it, not the comparison itself.
		it("reports base-divergence naming BOTH the node's declared base and the CLI's own base", () => {
			const r = buildContextReport({
				...BASE,
				cliBase: "/home/op/git/rcdc5",
				cliBaseOrigin: "cwd",
				nodeEnvironment: { ...NODE_ENVIRONMENT_AGREEING, base: "/home/op" },
			});
			const divergence = r.divergences.find((d) => d.kind === "base-divergence");
			expect(divergence).toBeDefined();
			expect(divergence?.summary).toContain("/home/op/git/rcdc5");
			expect(divergence?.summary).toContain("/home/op");
			expect(divergence?.summary).toContain("told");
		});

		// THE CRITICAL fix (final fix wave, 2026-08-06): the node's base comes from
		// `node.declarationBase` — its own descriptor, published AFTER `main.rs` settles
		// `SOVEREIGN_BASE` — NEVER reconstructed from `nodeEnvironment.cwd`. This test sets
		// `cwd` to a value that is NEITHER `declarationBase` NOR `cliBase`: if the comparison
		// ever again used `cwd` (the exact old bug), it would either report the wrong pair of
		// values or miss the divergence entirely. The node declares no `SOVEREIGN_BASE` in
		// its environ (`base: null`) — the "derived" case — and still correctly diverges on
		// its REAL, settled base.
		it("diverges on the node's REAL settled base (declarationBase), never on its /proc/<pid>/cwd", () => {
			const r = buildContextReport({
				...BASE,
				node: { ...BASE.node!, declarationBase: "/home/op" },
				cliBase: "/home/op/git/rcdc5",
				cliBaseOrigin: "cwd",
				nodeEnvironment: {
					...NODE_ENVIRONMENT_AGREEING,
					base: null,
					cwd: "/somewhere/else/entirely",
				},
			});
			const divergence = r.divergences.find((d) => d.kind === "base-divergence");
			expect(divergence).toBeDefined();
			expect(divergence?.summary).toContain("/home/op");
			expect(divergence?.summary).toContain("/home/op/git/rcdc5");
			expect(divergence?.summary).toContain("derived");
			expect(divergence?.summary).not.toContain("/somewhere/else/entirely");
		});

		// SECOND fix (final fix wave, 2026-08-06): the OLD guard reconstructed the node's base
		// as `nodeEnvironment.base ?? nodeEnvironment.cwd` and only compared when the RESULT
		// was non-null. So when the environ read succeeded, declared no base, AND
		// `/proc/<pid>/cwd` was itself unreadable — a state `NodeEnvironment` explicitly
		// supports (`cwd: string | null`, independent of the environ read succeeding) — the
		// reconstruction came out `null` and the comparison was silently skipped: two states
		// where three belonged, inside the guard built to prevent exactly that. Using
		// `declarationBase` removes `cwd` from the base comparison entirely, so this exact
		// combination must still correctly compare and diverge.
		it("still compares and diverges even when the environ declares no base AND /proc/<pid>/cwd is unreadable — the old guard silently skipped exactly this", () => {
			const r = buildContextReport({
				...BASE,
				node: { ...BASE.node!, declarationBase: "/home/op" },
				cliBase: "/home/op/git/rcdc5",
				cliBaseOrigin: "cwd",
				nodeEnvironment: { ...NODE_ENVIRONMENT_AGREEING, base: null, cwd: null },
			});
			const kinds = r.divergences.map((d) => d.kind);
			expect(kinds).toContain("base-divergence");
			const divergence = r.divergences.find((d) => d.kind === "base-divergence");
			expect(divergence?.summary).toContain("/home/op");
			expect(divergence?.summary).toContain("/home/op/git/rcdc5");
		});

		it("reports namespace-divergence when the node's own namespace differs from the CLI's", () => {
			const r = buildContextReport({
				...BASE,
				cliNamespace: "default",
				nodeEnvironment: { ...NODE_ENVIRONMENT_AGREEING, namespace: "prod" },
			});
			const divergence = r.divergences.find((d) => d.kind === "namespace-divergence");
			expect(divergence).toBeDefined();
			expect(divergence?.summary).toContain("prod");
			expect(divergence?.summary).toContain("default");
		});

		// THE case most likely to be got wrong (brief + task instructions, three times now):
		// the node IS running but its environ could NOT be read. A silent fallback to
		// comparing the CLI's own namespace against itself would find nothing to disagree
		// about and report agreement — a false "clean" manufactured from a comparison that
		// never happened. This must be `node-environment-unknown`, and specifically NOT
		// `namespace-divergence` and NOT silence (agreement was never established). Base is
		// NOT affected (final fix wave, 2026-08-06): `declarationBase` is a separate witness
		// from the descriptor, so it stays known and silent here (`BASE.node.declarationBase`
		// agrees with `BASE.cliBase` by fixture construction) even though the environ read
		// failed — proving the two questions are genuinely independent now.
		it("an unreadable node environment is node-environment-unknown for namespace — base is UNAFFECTED, since it has its own witness", () => {
			const r = buildContextReport({ ...BASE, nodeEnvironment: null });
			const kinds = r.divergences.map((d) => d.kind);
			expect(kinds).toContain("node-environment-unknown");
			expect(kinds).not.toContain("base-divergence");
			expect(kinds).not.toContain("namespace-divergence");
			// And it must name the node that IS running — this is not the node-not-running case.
			const divergence = r.divergences.find((d) => d.kind === "node-environment-unknown");
			expect(divergence?.summary).toContain(String(BASE.node?.pid));
		});
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
