import { describe, expect, it } from "vitest";
import { mergePluginFacts, nodePluginDevelopmentIds, type PluginFacts } from "./plugin-runtime.js";

/**
 * Direct unit coverage of `mergePluginFacts` — the pure merge `plugin status` composes its
 * five facts from. Two branches the CapabilityGroup-level tests (plugin-capability.test.ts,
 * plugin.test.ts) exercise only incidentally get dedicated coverage here:
 *
 *   - the UNMATCHED `requested` entry (a path the daemon was handed that no installed
 *     directory answers to), both halves — `id` present and `id: null` (the failed-load case,
 *     where `path` is the only identity `runtimeId` can fall back to);
 *   - `known` (D2's fifth fact): a declared-and-not-installed row, and that a known id which
 *     IS installed gets `known: true` on its real row rather than a second phantom one.
 */
describe("mergePluginFacts", () => {
	it("gives an unmatched requested entry its own row when id is present", () => {
		// The daemon was handed this path; the CLI's scan never found a directory for it
		// (deleted since boot, or outside the scanned base dir). Absence must declare itself
		// here too, not just for an installed-and-never-requested tree.
		const rows = mergePluginFacts(
			{
				requested: [
					{ id: "@refarm/orphan", path: "/p/refarm_orphan/plugin.wasm", loaded: true, because: null },
				],
				loaded: ["orphan"],
			},
			[],
			[],
		);

		expect(rows).toEqual<PluginFacts[]>([
			{
				runtimeId: "orphan",
				manifestId: "@refarm/orphan",
				dir: null,
				requested: true,
				loaded: true,
				installed: false,
				integrity: null,
				known: false,
				development: false,
			},
		]);
	});

	it("falls back to `path` as the runtime id when id is null (the load failed before the manifest could be read)", () => {
		const rows = mergePluginFacts(
			{
				requested: [
					{
						id: null,
						path: "/p/refarm_broken/plugin.wasm",
						loaded: false,
						because: "wasm parse error: unexpected end of file",
					},
				],
				loaded: [],
			},
			[],
			[],
		);

		expect(rows).toEqual<PluginFacts[]>([
			{
				runtimeId: "/p/refarm_broken/plugin.wasm",
				manifestId: null,
				dir: null,
				requested: true,
				loaded: false,
				installed: false,
				integrity: null,
				known: false,
				development: false,
			},
		]);
	});

	it("a known plugin with no installed tree and no request appears as declared-and-not-installed, never a placeholder pretending to be installed", () => {
		const rows = mergePluginFacts({ requested: [], loaded: [] }, [], [{ id: "@refarm/agent" }]);

		expect(rows).toEqual<PluginFacts[]>([
			{
				runtimeId: "agent",
				manifestId: "@refarm/agent",
				dir: null,
				requested: false,
				loaded: false,
				installed: false,
				integrity: null,
				known: true,
				development: false,
			},
		]);
	});

	it("reports NOT loaded when the boot record says loaded but the live channel list does not — the live fact, never the frozen boot record, answers `loaded`", () => {
		// A teardown or a failed hot-reload changes `plugin_channels` (the live fact) without
		// ever touching the `requested[]` boot record `record_plugin_request` wrote at startup
		// (`unregister` removes the channel and updates nothing else). This constructs exactly
		// that disagreement: the boot record still says `loaded: true`, the live list is empty.
		const rows = mergePluginFacts(
			{
				requested: [
					{ id: "@refarm/agent", path: "/p/refarm_agent/plugin.wasm", loaded: true, because: null },
				],
				loaded: [],
			},
			[
				{
					manifestId: "@refarm/agent",
					runtimeId: "agent",
					dir: "/p/refarm_agent",
					integrity: "matches",
				},
			],
			[],
		);

		expect(rows).toEqual<PluginFacts[]>([
			{
				runtimeId: "agent",
				manifestId: "@refarm/agent",
				dir: "/p/refarm_agent",
				requested: true,
				loaded: false,
				installed: true,
				integrity: "matches",
				known: false,
				development: false,
			},
		]);
	});

	it("a known plugin that IS installed carries known:true on its real row, not a second phantom row", () => {
		const rows = mergePluginFacts(
			{ requested: [], loaded: [] },
			[
				{
					manifestId: "@refarm/agent",
					runtimeId: "agent",
					dir: "/p/refarm_agent",
					integrity: "matches",
				},
			],
			[{ id: "@refarm/agent" }],
		);

		expect(rows).toHaveLength(1);
		expect(rows).toEqual<PluginFacts[]>([
			{
				runtimeId: "agent",
				manifestId: "@refarm/agent",
				dir: "/p/refarm_agent",
				requested: false,
				loaded: false,
				installed: true,
				integrity: "matches",
				known: true,
				development: false,
			},
		]);
	});

	it("carries development:true for a runtime id THIS NODE declared under development, and false for one it did not", () => {
		// Two installed trees, only one of which the node declared under development —
		// `mergePluginFacts` must attach the fact PER ROW (by runtime id), never blanket-apply
		// or blanket-omit it.
		const rows = mergePluginFacts(
			{ requested: [], loaded: [] },
			[
				{
					manifestId: "@refarm/agent",
					runtimeId: "agent",
					dir: "/p/refarm_agent",
					integrity: "absent",
				},
				{
					manifestId: "@refarm/lsp-code-ops",
					runtimeId: "lsp-code-ops",
					dir: "/p/refarm_lsp-code-ops",
					integrity: "absent",
				},
			],
			[],
			new Set(["agent"]),
		);

		const agent = rows.find((r) => r.runtimeId === "agent");
		const lspCodeOps = rows.find((r) => r.runtimeId === "lsp-code-ops");
		expect(agent?.development).toBe(true);
		expect(lspCodeOps?.development).toBe(false);
	});
});

/**
 * `nodePluginDevelopmentIds` — the "read from the node's config" half of the development
 * axis. Every OTHER test in this file exercises `development` via an INJECTED `Set`
 * (`new Set(["agent"])`) or the literal `false`, so an implementation that always returns
 * `new Set()` regardless of config would pass the rest of the suite. These tests pass a
 * REAL config object (the same shape `.refarm/config.json` holds, and the exact shape
 * `packages/config`'s `readPluginDevelopment` parses) and read the Set back through the
 * real reader — no hand-built Set stands in for it anywhere below.
 */
describe("nodePluginDevelopmentIds", () => {
	it("keys the returned Set by the RUNTIME id, reading a real config object through the real reader", () => {
		const config = { pluginDevelopment: { "@refarm/agent": { declaredAt: "2026-08-26" } } };
		const ids = nodePluginDevelopmentIds(config);
		expect(ids.has("agent")).toBe(true);
		expect(ids.has("lsp-code-ops")).toBe(false);
	});

	it("is empty for a config that declares nothing under development", () => {
		expect(nodePluginDevelopmentIds({}).size).toBe(0);
	});

	it("flows a real config's declaration through to `development: true` end to end via mergePluginFacts", () => {
		// The Set fed to mergePluginFacts here is PRODUCED by nodePluginDevelopmentIds from a
		// real config object, not written by hand as `new Set(["agent"])` — this is the path
		// `buildRuntimePluginStatusReport` actually takes (config → nodePluginDevelopmentIds →
		// mergePluginFacts), proven without a live `.refarm/config.json` on disk.
		const config = { pluginDevelopment: { "@refarm/agent": { declaredAt: "2026-08-26" } } };
		const rows = mergePluginFacts(
			{ requested: [], loaded: [] },
			[
				{
					manifestId: "@refarm/agent",
					runtimeId: "agent",
					dir: "/p/refarm_agent",
					integrity: "absent",
				},
				{
					manifestId: "@refarm/lsp-code-ops",
					runtimeId: "lsp-code-ops",
					dir: "/p/refarm_lsp-code-ops",
					integrity: "absent",
				},
			],
			[],
			nodePluginDevelopmentIds(config),
		);

		const agent = rows.find((r) => r.runtimeId === "agent");
		const lspCodeOps = rows.find((r) => r.runtimeId === "lsp-code-ops");
		expect(agent?.development).toBe(true);
		expect(lspCodeOps?.development).toBe(false);
	});
});
