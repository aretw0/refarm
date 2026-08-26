import { describe, expect, it } from "vitest";
import { mergePluginFacts, type PluginFacts } from "./plugin-runtime.js";

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
			},
		]);
	});
});
