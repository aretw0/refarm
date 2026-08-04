import { describe, expect, it } from "vitest";
import {
	buildHealthRecommendations,
	buildHealthReport,
	collectSkippedAuditors,
	type HealthResults,
} from "./health.js";

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

/**
 * The measured defect this program's health-base task fixed: `refarm health
 * --json` run from a node base (the operator's `~`, not a project) reported
 * 1301 `git_ignored` findings about files in OTHER, unrelated git
 * repositories nested under it. generic_fs and project
 * (packages/health/src/auditors/{generic,project}.js) now self-report
 * `applicable: false` when `rootDir` is not a project — these tests pin that
 * `runHealthAudit`'s wiring (collectSkippedAuditors + buildHealthReport)
 * surfaces that at the envelope's top level, rather than letting the
 * resulting empty arrays read as "checked, all clear".
 */
describe("collectSkippedAuditors", () => {
	it("is empty when the orchestrator is absent", () => {
		expect(collectSkippedAuditors(undefined, {})).toEqual([]);
	});

	it("lists an auditor as skipped when it self-reported applicable: false with a reason", () => {
		const skipped = collectSkippedAuditors(
			{
				generic_fs: { git: [], applicable: false, reason: "not a project" },
				project: { applicable: true },
				"config-node": { issues: [], note: "in sync" },
			},
			{ generic_fs: "Generic FileSystem & Git Visibility", project: "Refarm Monorepo Health" },
		);
		expect(skipped).toEqual([
			{ id: "generic_fs", title: "Generic FileSystem & Git Visibility", reason: "not a project" },
		]);
	});

	it("falls back to the raw id when no title was supplied", () => {
		const skipped = collectSkippedAuditors(
			{ generic_fs: { applicable: false, reason: "not a project" } },
			{},
		);
		expect(skipped).toEqual([{ id: "generic_fs", title: "generic_fs", reason: "not a project" }]);
	});

	it("does NOT list an auditor that ran and simply found nothing (applicable undefined, e.g. config-node)", () => {
		const skipped = collectSkippedAuditors({ "config-node": { issues: [], note: "in sync" } }, {});
		expect(skipped).toEqual([]);
	});

	it("does not list applicable: false without a reason (defensive — should not happen in practice)", () => {
		const skipped = collectSkippedAuditors({ generic_fs: { applicable: false } }, {});
		expect(skipped).toEqual([]);
	});
});

describe("buildHealthReport — skippedAuditors", () => {
	it("defaults to an empty list when not passed (backward compatible)", () => {
		const report = buildHealthReport(emptyResults(), []);
		expect(report.skippedAuditors).toEqual([]);
	});

	it("carries the skipped list through, and stays ok/0-issues when skipping is the only reason results are empty", () => {
		const skippedAuditors = [
			{ id: "generic_fs", title: "Generic FileSystem & Git Visibility", reason: "not a project" },
			{ id: "project", title: "Refarm Monorepo Health", reason: "not a project" },
		];
		const report = buildHealthReport(emptyResults(), [], skippedAuditors);
		expect(report.skippedAuditors).toEqual(skippedAuditors);
		expect(report.ok).toBe(true);
		expect(report.issueCount).toBe(0);
	});
});
