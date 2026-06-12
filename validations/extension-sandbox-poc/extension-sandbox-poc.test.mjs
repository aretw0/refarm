import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
	buildPilotScorecard,
	buildPolicyDecision,
	buildTaskArtefactManifest,
	runExtensionSandboxPoc,
} from "./extension-sandbox-poc.mjs";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures", "expected");

function readFixture(fileName) {
	return JSON.parse(readFileSync(path.join(FIXTURES_DIR, fileName), "utf8"));
}

describe("extension sandbox poc", () => {
	it("validates manifests and completes the benign lifecycle path", () => {
		const report = runExtensionSandboxPoc();
		const completed = report.policies
			.flatMap((policy) => policy.plugins)
			.filter((plugin) => plugin.pluginId === "@example/benign-extension");

		assert.equal(completed.length, 2);
		assert.ok(completed.every((plugin) => plugin.manifestValid));
		assert.ok(completed.every((plugin) => plugin.status === "completed"));
		assert.ok(completed.every((plugin) => plugin.events.length === 3));
	});

	it("blocks extensions that require capabilities outside the grant", () => {
		const report = runExtensionSandboxPoc();
		const denied = report.policies
			.flatMap((policy) => policy.plugins)
			.filter((plugin) => plugin.pluginId === "@example/denied-extension");

		assert.equal(denied.length, 2);
		assert.ok(
			denied.every((plugin) => plugin.missingCapabilities.includes("network:v1")),
		);
		assert.deepEqual(
			denied.map((plugin) => plugin.status).sort(),
			["blocked-fail-fast", "blocked-warn-continue"],
		);
	});

	it("distinguishes warn+continue from fail-fast failure handling", () => {
		const report = runExtensionSandboxPoc();
		const warn = report.policies.find((policy) => policy.policyMode === "warn+continue");
		const strict = report.policies.find((policy) => policy.policyMode === "fail-fast");

		assert.equal(warn?.hostStatus, "continued");
		assert.equal(strict?.hostStatus, "aborted");
		assert.equal(report.checks.warnContinueSurvivesFailure, true);
		assert.equal(report.checks.failFastAbortsFailure, true);
	});

	it("publishes a human-reviewable policy decision", () => {
		const report = runExtensionSandboxPoc();
		const decision = buildPolicyDecision(report.policies);

		assert.deepEqual(report.policyDecision, decision);
		assert.equal(decision.defaultMode, "fail-fast");
		assert.equal(decision.operatorReview.required, true);
		assert.deepEqual(
			decision.deniedPlugins.map((plugin) => plugin.missingCapabilities).flat(),
			["network:v1", "network:v1"],
		);
		assert.deepEqual(decision.isolatedFailures, ["@example/failing-extension"]);
	});

	it("publishes a pilot scorecard with adoption thresholds", () => {
		const report = runExtensionSandboxPoc();
		const scorecard = buildPilotScorecard(report);

		assert.deepEqual(readFixture("scorecard.json"), scorecard);
		assert.equal(scorecard.scale, 5);
		assert.equal(scorecard.gate, "continue");
		assert.equal(scorecard.finalScore, 4.85);
		assert.equal(scorecard.scores.manifestPolicy, 5);
		assert.equal(scorecard.scores.humanReview, 4);
		assert.equal(scorecard.thresholds.continue, 4.5);
		assert.match(scorecard.limits[0], /Simulated lifecycle/);
	});

	it("keeps generated fixtures deterministic", () => {
		const report = runExtensionSandboxPoc();

		assert.deepEqual(readFixture("sandbox-report.json"), report);
		assert.deepEqual(readFixture("policy-decision.json"), report.policyDecision);
		const scenario = readFileSync(path.join(FIXTURES_DIR, "scenario.md"), "utf8");
		assert.match(scenario, /Extension Sandbox PoC Scenario/);
		assert.match(scenario, /Decision Points/);
		const annex = readFileSync(path.join(FIXTURES_DIR, "annex.md"), "utf8");
		assert.match(annex, /Evidence Map/);
		assert.match(annex, /scorecard\.json/);
		const markdown = readFileSync(path.join(FIXTURES_DIR, "sandbox-report.md"), "utf8");
		assert.match(markdown, /No real plugins, services, institutional data, or secrets/);
		assert.match(markdown, /Warn\+continue survives isolated failure: true/);
	});

	it("publishes a task artefact manifest for downstream consumers", () => {
		const manifest = readFixture("task-artefacts.json");

		assert.equal(manifest.schema, "refarm.task-artefacts.v1");
		assert.equal(manifest.taskId, "task-extension-sandbox-poc");
		assert.equal(manifest.effortId, "effort-extension-sandbox-poc-001");
		assert.deepEqual(
			manifest.artefacts.map((artefact) => artefact.uri),
			[
				"sandbox-report.json",
				"policy-decision.json",
				"scorecard.json",
				"scenario.md",
				"annex.md",
				"sandbox-report.md",
			],
		);
		assert.ok(
			manifest.artefacts.every(
				(artefact) =>
					artefact.hash.algorithm === "sha256" &&
					/^[a-f0-9]{64}$/.test(artefact.hash.value) &&
					artefact.provenance.runId === "extension-sandbox-poc-001",
			),
		);
	});

	it("builds the task artefact manifest deterministically", () => {
		const expected = readFixture("task-artefacts.json");
		const actual = buildTaskArtefactManifest(
			Object.fromEntries(
				expected.artefacts.map((artefact) => [
					artefact.uri,
					readFileSync(path.join(FIXTURES_DIR, artefact.uri), "utf8"),
				]),
			),
		);

		assert.deepEqual(actual, expected);
	});
});
