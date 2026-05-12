import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

function makeRunner(totalMinutes) {
	return { totalMinutes, runs: 5, completedRuns: 5, inProgressRuns: 0, workflows: [] };
}

function writeBudgetFixture({ netQuantity = 0 } = {}) {
	const tempDir = mkdtempSync(path.join(tmpdir(), "actions-budget-guard-"));
	const fixturePath = path.join(tempDir, "budget.json");
	writeFileSync(
		fixturePath,
		`${JSON.stringify(
			{
				// quota is the actionsQuota object; set available:false to exercise the cost-based fallback path.
				quota: { available: false, error: "disabled" },
				quotaBaseline: 2000,
				official: {
					available: true,
					usage: {
						grossQuantity: 5258,
						discountQuantity: 5258 - netQuantity,
						netQuantity,
					},
				},
				repos: [
					{
						repo: "aretw0/refarm",
						runner: makeRunner(1010),
						official: {
							available: true,
							usage: { grossQuantity: 1010, netQuantity: 0 },
						},
					},
					{
						repo: "aretw0/agents-lab",
						runner: makeRunner(500),
						official: {
							available: true,
							usage: { grossQuantity: 500, netQuantity: 0 },
						},
					},
					{
						// 600 min with 1/3 allocation of 2000 = burn 90% → WARN band (80–100%)
						repo: "aretw0/warn",
						runner: makeRunner(600),
						official: {
							available: true,
							usage: { grossQuantity: 600, netQuantity: 0 },
						},
					},
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return { fixturePath, tempDir };
}

function runGuard(args) {
	return spawnSync(
		process.execPath,
		["scripts/ci/actions-budget-guard.mjs", ...args],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
}

test("actions budget guard lists modes", () => {
	const output = runGuard(["--list-modes"]);
	assert.equal(output.status, 0, output.stderr);
	assert.equal(output.stdout.trim(), "account, allocation");
});

test("actions budget guard lists mode metadata as json", () => {
	const output = runGuard(["--list-modes", "--json"]);
	assert.equal(output.status, 0, output.stderr);
	assert.deepEqual(JSON.parse(output.stdout), {
		schemaVersion: 1,
		defaultMode: "account",
		modes: [
			{
				mode: "account",
				kind: "hard",
				description:
					"Account-month net billable posture against the quota baseline.",
				npmScript: "actions:budget:guard:account",
				jsonNpmScript: "actions:budget:guard:account:json",
			},
			{
				mode: "allocation",
				kind: "advisory",
				description:
					"Per-repo gross usage against the local 50/50 fairness split.",
				npmScript: "actions:budget:guard:allocation",
				jsonNpmScript: "actions:budget:guard:allocation:json",
			},
		],
	});
});

test("actions budget guard fails unknown modes with available mode hints", () => {
	const output = runGuard(["--mode", "unknown", "--input", "unused.json"]);
	assert.notEqual(output.status, 0);
	assert.match(output.stderr, /Unknown guard mode: unknown/);
	assert.match(output.stderr, /Expected one of: account, allocation/);
});

test("actions budget guard passes discounted account-month posture by default", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const result = runGuard(["--input", fixturePath]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /account status=OK/);
		assert.match(result.stdout, /billable=0 min/);
		assert.match(result.stdout, /gross=5258 min/);
		assert.match(result.stdout, /quotaRemaining=2000 min/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("actions budget guard fails account-month posture when net billable exceeds quota", () => {
	const { fixturePath, tempDir } = writeBudgetFixture({ netQuantity: 2001 });
	try {
		const result = runGuard(["--input", fixturePath]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /account status=OVER ALLOCATION/);
		assert.match(result.stderr, /billable=2001(\.\d+)? min/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("actions budget guard can print account decision json", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const result = runGuard(["--input", fixturePath, "--json"]);
		assert.equal(result.status, 0, result.stderr);
		const decision = JSON.parse(result.stdout);
		assert.equal(decision.schemaVersion, 1);
		assert.equal(decision.mode, "account");
		assert.equal(decision.status, "OK");
		assert.equal(decision.shouldFail, false);
		assert.equal(decision.failOnWarn, false);
		assert.equal(decision.quotaBaseline, 2000);
		assert.equal(decision.billableMinutes, 0);
		assert.equal(decision.quotaRemaining, 2000);
		assert.equal(decision.burn, 0);
		assert.equal(decision.grossMinutes, 5258);
		assert.match(decision.summary, /account status=OK/);
		assert.match(decision.summary, /billable=0 min/);
		assert.match(decision.summary, /quotaRemaining=2000 min/);
		assert.match(decision.summary, /gross=5258 min/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("actions budget guard json preserves failure exit codes", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const result = runGuard([
			"--input",
			fixturePath,
			"--mode",
			"allocation",
			"--json",
		]);
		assert.notEqual(result.status, 0);
		assert.equal(result.stderr, "");
		const decision = JSON.parse(result.stdout);
		assert.equal(decision.schemaVersion, 1);
		assert.equal(decision.mode, "allocation");
		assert.equal(decision.repo, "aretw0/refarm");
		assert.equal(decision.status, "OVER ALLOCATION");
		assert.equal(decision.shouldFail, true);
		assert.equal(decision.failOnWarn, false);
		assert.equal(decision.allocatedMinutes, 1000);
		assert.ok(decision.allocationRemaining < 0, "allocationRemaining should be negative");
		assert.ok(decision.burn > 1, "burn should exceed 1 for OVER ALLOCATION");
		assert.equal(decision.runnerMinutes, 1010);
		assert.equal(decision.officialGrossMinutes, 1010);
		assert.match(decision.summary, /OVER ALLOCATION/);
		assert.match(decision.summary, /runner-time=1010 min/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("actions budget guard can preserve advisory allocation failures", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const result = runGuard(["--input", fixturePath, "--mode", "allocation"]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /OVER ALLOCATION/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("actions budget guard passes ok allocation reports", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const result = runGuard([
			"--input",
			fixturePath,
			"--repo",
			"aretw0/agents-lab",
			"--mode",
			"allocation",
		]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /status=OK/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("actions budget guard can fail warning reports", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const warnPass = runGuard([
			"--input",
			fixturePath,
			"--repo",
			"aretw0/warn",
			"--mode",
			"allocation",
		]);
		assert.equal(warnPass.status, 0, warnPass.stderr);
		assert.match(warnPass.stdout, /status=WARN/);

		const warnFail = runGuard([
			"--input",
			fixturePath,
			"--repo",
			"aretw0/warn",
			"--mode",
			"allocation",
			"--fail-on-warn",
		]);
		assert.notEqual(warnFail.status, 0);
		assert.match(warnFail.stderr, /status=WARN/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
