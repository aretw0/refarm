import { describe, expect, it } from "vitest";
import { buildHealthRecommendations, buildHealthReport, type HealthResults } from "./health.js";

/**
 * The config-node auditor (packages/health/src/auditors/config-node.js) can
 * now emit THREE distinct issue types: `config_node_drift`, `config_node_invalid`
 * (checked, found a problem), and `config_node_unreachable` (could not check at
 * all — the graph read itself threw). These tests pin that `buildHealthReport`
 * and `buildHealthRecommendations` treat all three as real issues (never as a
 * silent clean pass) and describe `config_node_unreachable` honestly — not with
 * the "malformed" wording that belongs to `config_node_invalid` — since telling
 * an operator to "reconcile a malformed node" when the node was never actually
 * read would be a second, different lie.
 */
function emptyResults(): HealthResults {
	return { git: [], builds: [], alignment: [] };
}

describe("buildHealthReport — configNode", () => {
	it("is NOT ok when the config-node auditor could not check (config_node_unreachable)", () => {
		const results: HealthResults = {
			...emptyResults(),
			configNode: [
				{
					type: "config_node_unreachable",
					path: "urn:sovereign:config:workspace",
					note: "could not read the config graph node: boom",
				},
			],
		};
		const report = buildHealthReport(results, []);
		expect(report.ok).toBe(false);
		expect(report.issueCount).toBe(1);
	});

	it("is ok when the config-node auditor found nothing (empty configNode array)", () => {
		const report = buildHealthReport({ ...emptyResults(), configNode: [] }, []);
		expect(report.ok).toBe(true);
		expect(report.issueCount).toBe(0);
	});
});

describe("buildHealthRecommendations — configNode presentation", () => {
	it("describes config_node_unreachable as a read failure, not as malformed data", () => {
		const results: HealthResults = {
			...emptyResults(),
			configNode: [
				{
					type: "config_node_unreachable",
					path: "urn:sovereign:config:workspace",
					note: "could not read the config graph node: boom",
				},
			],
		};
		const [recommendation] = buildHealthRecommendations(results);
		expect(recommendation?.issueType).toBe("config_node_unreachable");
		expect(recommendation?.summary).toMatch(/could not be read/i);
		expect(recommendation?.summary).not.toMatch(/malformed/i);
	});

	it("still describes config_node_drift and config_node_invalid distinctly", () => {
		const results: HealthResults = {
			...emptyResults(),
			configNode: [
				{ type: "config_node_drift", path: "urn:sovereign:config:workspace" },
				{ type: "config_node_invalid", path: "urn:sovereign:config:workspace" },
			],
		};
		const [drift, invalid] = buildHealthRecommendations(results);
		expect(drift?.summary).toMatch(/differs from the local/i);
		expect(invalid?.summary).toMatch(/malformed/i);
	});

	it("falls back to the config_node_invalid wording for an unknown future issue type, rather than dropping it", () => {
		const results: HealthResults = {
			...emptyResults(),
			configNode: [{ type: "config_node_some_future_type", path: "urn:sovereign:config:workspace" }],
		};
		const [recommendation] = buildHealthRecommendations(results);
		expect(recommendation).toBeDefined();
		expect(recommendation?.summary).toMatch(/malformed/i);
	});
});
