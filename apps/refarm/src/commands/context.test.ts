import { describe, expect, it } from "vitest";
import type { NodeContextMetadata } from "../utils/context-metadata.js";
import { buildContextReport, type ContextInput } from "./context.js";

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

	// The sixth divergence kind the brief omitted (correction (b)): ADR-094's H3 verbatim —
	// the Silo credential home disagreeing with the Refarm sovereign home is a bug or a
	// declared divergence, not an implementation detail. `resolveNodeContextMetadata`
	// already computes this as `homesAligned`; this is the first place it becomes a
	// reported finding rather than a silent boolean.
	it("reports the sovereign home and the credential home disagreeing", () => {
		const r = buildContextReport({
			...BASE,
			metadata: { ...METADATA, credentialStoreHome: "/home/op/.silo-other", homesAligned: false },
		});
		expect(r.divergences.map((d) => d.kind)).toContain("credential-home-divergence");
	});

	it("is silent about credential homes when they align", () => {
		const r = buildContextReport(BASE);
		expect(r.divergences.map((d) => d.kind)).not.toContain("credential-home-divergence");
	});
});
