import { describe, expect, it } from "vitest";
import type { RuntimeFreshness } from "../utils/runtime-freshness.js";
import { buildRuntimeFreshnessDoctorRecommendations } from "./runtime-freshness-doctor.js";

const fresh: RuntimeFreshness = {
	state: "fresh",
	startedAt: "2026-08-04T14:20:36Z",
	artifacts: [
		{ artifact: "/opt/refarm/tractor", state: "fresh", reason: "older than the running node" },
	],
};

describe("runtime freshness doctor finding", () => {
	it("says nothing when the node is running what is on disk", () => {
		// Silence is the point. A node that is current deserves no line, the same rule
		// node-name-doctor follows for a node that already declared a name.
		expect(buildRuntimeFreshnessDoctorRecommendations(fresh)).toEqual([]);
	});

	it("says nothing when there is no freshness result at all", () => {
		expect(buildRuntimeFreshnessDoctorRecommendations(null)).toEqual([]);
	});

	it("reports the real 2026-08-04 case, and names only the stale artifact", () => {
		const result = buildRuntimeFreshnessDoctorRecommendations({
			state: "stale",
			startedAt: "2026-08-04T14:20:36Z",
			artifacts: [
				{
					artifact: "/opt/refarm/tractor",
					state: "stale",
					reason: "changed after the running node started, so the node is not running it",
					modifiedAt: "2026-08-04T23:34:15.000Z",
				},
				{
					artifact: "/home/op/.refarm/plugins/@refarm/agent/plugin.wasm",
					state: "fresh",
					reason: "older than the running node, so the node loaded this version",
				},
			],
		});
		expect(result).toHaveLength(1);
		expect(result[0]?.diagnostic).toBe("runtime:stale");
		expect(result[0]?.severity).toBe("warning");
		expect(result[0]?.summary).toContain("/opt/refarm/tractor");
		expect(result[0]?.summary).toContain("2026-08-04T23:34:15.000Z");
		// A report that blames the healthy artifact too is one nobody reads.
		expect(result[0]?.summary).not.toContain("plugin.wasm");
	});

	it("refuses to restart on the operator's behalf, and says why", () => {
		const result = buildRuntimeFreshnessDoctorRecommendations({
			state: "stale",
			artifacts: [{ artifact: "/opt/refarm/tractor", state: "stale", reason: "changed after" }],
		});
		expect(result[0]?.action).toMatch(/NOT done for you/);
		expect(result[0]?.action).toMatch(/interrupts/);
	});

	it("reports unknown as unverified, distinctly from stale, and never as fine", () => {
		// The third state is the reason this module exists. Rounding it down to fine would
		// rebuild the defect it was written to remove.
		const result = buildRuntimeFreshnessDoctorRecommendations({
			state: "unknown",
			artifacts: [
				{
					artifact: "node.json",
					state: "unknown",
					reason: "the node does not say when it started, so nothing can be compared to it",
				},
			],
		});
		expect(result).toHaveLength(1);
		expect(result[0]?.diagnostic).toBe("runtime:freshness-unknown");
		expect(result[0]?.summary).toMatch(/could not be established/);
		expect(result[0]?.action).toMatch(/unverified rather than fine/);
	});
});
