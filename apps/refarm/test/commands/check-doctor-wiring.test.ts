// Regression coverage for the 2026-08-05 fix wave, Fix 1.
//
// `check.ts`'s `runDefaultDoctor` is the ONLY `buildRefarmDoctorReport` call `refarm check`
// makes. Before this fix it passed `context` but never `runtimeFreshness` or
// `sovereignDivergences`, so those two `?? []` defaults inside `buildRefarmDoctorReport`
// always won — `refarm doctor --json` could list `sovereign:plugin-divergence` while
// `refarm check --next-action --json` (the "all clear" signal CLAUDE.md §4 tells every
// agent to trust) never even saw the comparison. These tests drive `runDefaultDoctor`
// directly with stubbed resolvers and would fail if either were dropped from its
// `buildRefarmDoctorReport` call again.
import type { StatusJson } from "@refarm.dev/cli/status";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveStatusPayload, mockShutdown, mockResolveFreshness, mockResolveSovereignDivergences } =
	vi.hoisted(() => ({
		mockResolveStatusPayload: vi.fn(),
		mockShutdown: vi.fn().mockResolvedValue(undefined),
		mockResolveFreshness: vi.fn(),
		mockResolveSovereignDivergences: vi.fn(),
	}));

vi.mock("../../src/commands/status.js", () => ({
	resolveStatusPayload: mockResolveStatusPayload,
}));

vi.mock("../../src/commands/doctor.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/commands/doctor.js")>();
	return {
		...actual,
		resolveFreshness: mockResolveFreshness,
		resolveSovereignDivergences: mockResolveSovereignDivergences,
	};
});

import { runDefaultDoctor } from "../../src/commands/check.js";

function makeStatus(): StatusJson {
	return {
		schemaVersion: 1,
		host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
		renderer: { id: "refarm-headless", kind: "headless", capabilities: ["diagnostics"] },
		runtime: { ready: true, namespace: "refarm-main", databaseName: "refarm-main" },
		plugins: { installed: 0, active: 0, rejectedSurfaces: 0, surfaceActions: 0 },
		trust: { profile: "dev", warnings: 0, critical: 0 },
		streams: { active: 0, terminal: 0 },
		diagnostics: [],
	};
}

describe("runDefaultDoctor — check's own buildRefarmDoctorReport call", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveStatusPayload.mockResolvedValue({ json: makeStatus(), shutdown: mockShutdown });
		mockResolveFreshness.mockReturnValue(null);
		mockResolveSovereignDivergences.mockReturnValue([]);
	});

	it("passes a resolved runtimeFreshness through, so a stale finding reaches the report", async () => {
		mockResolveFreshness.mockReturnValue({
			state: "stale",
			startedAt: "2026-08-04T14:20:36Z",
			artifacts: [
				{
					artifact: "/opt/refarm/tractor",
					state: "stale",
					reason: "changed after the running node started, so the node is not running it",
				},
			],
		});

		const report = await runDefaultDoctor({});

		expect(mockResolveFreshness).toHaveBeenCalled();
		expect(report.warnings).toContain("runtime:stale");
	});

	it("passes resolved sovereignDivergences through, so a plugin-hash mismatch reaches the report", async () => {
		mockResolveSovereignDivergences.mockReturnValue([
			{
				kind: "plugin-hash-mismatch",
				summary:
					"Loaded plugin /home/op/.refarm/plugins/refarm_agent/plugin.wasm (22dbabbd) does not " +
					"match the built plugin /home/op/refarm/packages/agent/dist/agent.wasm (544ef5b4).",
			},
		]);

		const report = await runDefaultDoctor({});

		expect(mockResolveSovereignDivergences).toHaveBeenCalled();
		expect(report.warnings).toContain("sovereign:plugin-divergence");
	});

	it("surfaces both at once — the exact live symptom: doctor sees the divergence, check must too", async () => {
		mockResolveFreshness.mockReturnValue({
			state: "unknown",
			artifacts: [
				{
					artifact: "agent plugin",
					state: "unknown",
					reason: "the installed agent plugin could not be located",
				},
			],
		});
		mockResolveSovereignDivergences.mockReturnValue([
			{ kind: "plugin-hash-mismatch", summary: "diverged" },
		]);

		const report = await runDefaultDoctor({});

		// Reverting to the pre-fix `?? []` defaults would silently drop both of these —
		// this is the assertion that catches that regression.
		expect(report.warnings).toEqual(
			expect.arrayContaining(["runtime:freshness-unknown", "sovereign:plugin-divergence"]),
		);
	});

	it("still omits connectionConfig — the deliberate omission is unaffected by this fix", async () => {
		// Guards against the fix accidentally widening scope: `check` must stay silent about
		// declared connections (see the long comment in `runDefaultDoctor` explaining why),
		// independent of the runtimeFreshness/sovereignDivergences wiring this file tests.
		const report = await runDefaultDoctor({});

		expect(report.warnings.some((warning) => warning.startsWith("connection:"))).toBe(false);
	});
});
