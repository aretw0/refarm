import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

function writeBudgetFixture({ netQuantity = 0 } = {}) {
	const tempDir = mkdtempSync(path.join(tmpdir(), "actions-budget-guard-"));
	const fixturePath = path.join(tempDir, "budget.json");
	writeFileSync(
		fixturePath,
		`${JSON.stringify(
			{
				quota: 2000,
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
						official: { available: true },
						officialAllocationRemaining: -1,
						officialAllocationBurn: 1.01,
					},
					{
						repo: "aretw0/agents-lab",
						official: { available: true },
						officialAllocationRemaining: 200,
						officialAllocationBurn: 0.5,
					},
					{
						repo: "aretw0/warn",
						official: { available: true },
						officialAllocationRemaining: 10,
						officialAllocationBurn: 0.9,
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

test("actions budget guard passes discounted account-month posture by default", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const result = runGuard(["--input", fixturePath]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /account status=OK/);
		assert.match(result.stdout, /billable=0 min/);
		assert.match(result.stdout, /gross=5258 min/);
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
		assert.match(result.stderr, /billable=2001 min/);
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
