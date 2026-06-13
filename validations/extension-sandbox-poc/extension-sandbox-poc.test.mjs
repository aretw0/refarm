import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
	buildLimitsMarkdown,
	buildPilotScorecard,
	buildPolicyDecision,
	buildRiskAndStandardsMatrix,
	buildRuntimeEvidence,
	buildTaskArtifactManifest,
	PRODUCER_PROCESS,
	runExtensionSandboxPoc,
} from "./extension-sandbox-poc.mjs";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures", "expected");
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function readFixture(fileName) {
	return JSON.parse(readFileSync(path.join(FIXTURES_DIR, fileName), "utf8"));
}

function readPackageJson(...segments) {
	return JSON.parse(
		readFileSync(path.join(REPO_ROOT, ...segments, "package.json"), "utf8"),
	);
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

	it("publishes a risk and standards matrix without claiming conformance", () => {
		const report = runExtensionSandboxPoc();
		const matrix = buildRiskAndStandardsMatrix(report);

		assert.deepEqual(readFixture("risk-and-standards-matrix.json"), matrix);
		assert.equal(matrix.conformanceClaim, false);
		assert.equal(matrix.controls.length, 3);
		assert.ok(matrix.controls.every((control) => control.status === "demonstrated"));
		assert.deepEqual(
			matrix.gaps.map((gap) => gap.neededForClaim),
			["real plugin execution", "production plugin governance"],
		);
	});

	it("publishes runtime evidence that links to the real WASM validation path", () => {
		const report = runExtensionSandboxPoc();
		const evidence = buildRuntimeEvidence(report);

		assert.deepEqual(readFixture("runtime-evidence.json"), evidence);
		assert.equal(evidence.claimStatus, "adjacent-validation");
		assert.equal(evidence.syntheticPocScope, "simulated-lifecycle");
		assert.ok(
			evidence.evidenceCommands.some((command) =>
				command.command.includes("test:e2e:chromium"),
			),
		);
		assert.match(evidence.promotionBoundary.cannotSay, /synthetic sandbox report/);
	});

	it("keeps runtime evidence commands and linked files resolvable", () => {
		const report = runExtensionSandboxPoc();
		const evidence = buildRuntimeEvidence(report);
		const commandsById = Object.fromEntries(
			evidence.evidenceCommands.map((command) => [command.id, command.command]),
		);
		const helloWorld = readPackageJson("validations", "wasm-plugin", "hello-world");
		const wasmHost = readPackageJson("validations", "wasm-plugin", "host");
		const tractorTs = readPackageJson("packages", "tractor-ts");

		assert.equal(
			commandsById["hello-world-wasm-build"],
			`pnpm --filter ${helloWorld.name} run build`,
		);
		assert.ok(helloWorld.scripts.build);
		assert.equal(
			commandsById["browser-plugin-lifecycle-e2e"],
			"pnpm -C validations/wasm-plugin/host run test:e2e:chromium",
		);
		assert.ok(wasmHost.scripts["test:e2e:chromium"]);
		assert.equal(
			commandsById["tractor-jco-integration"],
			`pnpm --filter ${tractorTs.name} run test -- test/jco-integration.test.ts`,
		);
		assert.ok(tractorTs.scripts.test);
		assert.ok(
			existsSync(
				path.join(
					REPO_ROOT,
					"packages",
					"tractor-ts",
					"test",
					"jco-integration.test.ts",
				),
			),
		);

		for (const linkedPath of evidence.linkedEvidence) {
			assert.ok(existsSync(path.join(REPO_ROOT, linkedPath)), linkedPath);
		}
	});

	it("keeps generated fixtures deterministic", () => {
		const report = runExtensionSandboxPoc();

		assert.deepEqual(readFixture("sandbox-report.json"), report);
		assert.deepEqual(readFixture("policy-decision.json"), report.policyDecision);
		const scenario = readFileSync(path.join(FIXTURES_DIR, "scenario.md"), "utf8");
		assert.match(scenario, /Extension Sandbox PoC Scenario/);
		assert.match(scenario, /Decision Points/);
		const annex = readFileSync(path.join(FIXTURES_DIR, "annex.md"), "utf8");
		assert.match(annex, /Flow Table/);
		assert.match(annex, /Manifest submitted/);
		assert.match(annex, /Evidence Map/);
		assert.match(annex, /scorecard\.json/);
		const limits = readFileSync(path.join(FIXTURES_DIR, "limits.md"), "utf8");
		assert.equal(limits, buildLimitsMarkdown());
		assert.match(limits, /Do Not Claim/);
		assert.match(limits, /Real WebAssembly execution/);
		const markdown = readFileSync(path.join(FIXTURES_DIR, "sandbox-report.md"), "utf8");
		assert.match(markdown, /No real plugins, services, institutional data, or secrets/);
		assert.match(markdown, /Warn\+continue survives isolated failure: true/);
	});

	it("publishes a task artifact manifest for downstream consumers", () => {
		const manifest = readFixture("task-artifacts.json");

		assert.equal(manifest.schema, "refarm.task-artifacts.v1");
		assert.equal(manifest.taskId, "task-extension-sandbox-poc");
		assert.equal(manifest.effortId, "effort-extension-sandbox-poc-001");
		assert.deepEqual(
			manifest.artifacts.map((artifact) => artifact.uri),
			[
				"sandbox-report.json",
				"policy-decision.json",
				"scorecard.json",
				"risk-and-standards-matrix.json",
				"runtime-evidence.json",
				"scenario.md",
				"annex.md",
				"limits.md",
				"sandbox-report.md",
			],
		);
		assert.ok(
			manifest.artifacts.every(
				(artifact) =>
					artifact.hash.algorithm === "sha256" &&
					/^[a-f0-9]{64}$/.test(artifact.hash.value) &&
					artifact.provenance.runId === "extension-sandbox-poc-001" &&
					artifact.provenance.command === PRODUCER_PROCESS.display &&
					artifact.provenance.process.command === "node" &&
					artifact.provenance.process.args.length === 1,
			),
		);
	});

	it("builds the task artifact manifest deterministically", () => {
		const expected = readFixture("task-artifacts.json");
		const actual = buildTaskArtifactManifest(
			Object.fromEntries(
				expected.artifacts.map((artifact) => [
					artifact.uri,
					readFileSync(path.join(FIXTURES_DIR, artifact.uri), "utf8"),
				]),
			),
		);

		assert.deepEqual(actual, expected);
	});
});
