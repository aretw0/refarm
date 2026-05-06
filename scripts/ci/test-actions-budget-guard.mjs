import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

function writeBudgetFixture() {
	const tempDir = mkdtempSync(path.join(tmpdir(), "actions-budget-guard-"));
	const fixturePath = path.join(tempDir, "budget.json");
	writeFileSync(
		fixturePath,
		`${JSON.stringify(
			{
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

test("actions budget guard fails over-allocation reports", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const result = runGuard(["--input", fixturePath]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /OVER ALLOCATION/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("actions budget guard passes ok reports", () => {
	const { fixturePath, tempDir } = writeBudgetFixture();
	try {
		const result = runGuard([
			"--input",
			fixturePath,
			"--repo",
			"aretw0/agents-lab",
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
		const warnPass = runGuard(["--input", fixturePath, "--repo", "aretw0/warn"]);
		assert.equal(warnPass.status, 0, warnPass.stderr);
		assert.match(warnPass.stdout, /status=WARN/);

		const warnFail = runGuard([
			"--input",
			fixturePath,
			"--repo",
			"aretw0/warn",
			"--fail-on-warn",
		]);
		assert.notEqual(warnFail.status, 0);
		assert.match(warnFail.stderr, /status=WARN/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
