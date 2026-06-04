import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve("scripts/ci/check-node-substrate.mjs");
const binExt = process.platform === "win32" ? ".cmd" : "";

function makeWorkspace({ packageManager = "pnpm@11.1.2", withBins = false } = {}) {
	const tempDir = mkdtempSync(path.join(tmpdir(), "refarm-node-substrate-"));
	writeFileSync(
		path.join(tempDir, "package.json"),
		`${JSON.stringify({ packageManager }, null, 2)}\n`,
		"utf8",
	);

	if (withBins) {
		const binDir = path.join(tempDir, "node_modules", ".bin");
		mkdirSync(binDir, { recursive: true });
		for (const binary of ["vitest", "tsc", "eslint"]) {
			writeFileSync(path.join(binDir, `${binary}${binExt}`), "", "utf8");
		}
	}

	return tempDir;
}

function runCheck(cwd, args = ["--json"]) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

test("node substrate check reports missing workspace execution shims", () => {
	const tempDir = makeWorkspace();
	try {
		const result = runCheck(tempDir);
		assert.notEqual(result.status, 0);
		assert.equal(result.stderr, "");

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, false);
		assert.equal(payload.packageManager, "pnpm@11.1.2");
		assert.equal(payload.nextCommand, "pnpm install --frozen-lockfile --config.confirm-modules-purge=false");
		assert.deepEqual(
			payload.missing.map((check) => check.id),
			[
				"node_modules",
				"node_modules_bin",
				"bin_vitest",
				"bin_tsc",
				"bin_eslint",
			],
		);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check passes when required package manager shims exist", () => {
	const tempDir = makeWorkspace({ withBins: true });
	try {
		const result = runCheck(tempDir);
		assert.equal(result.status, 0, result.stderr);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, true);
		assert.deepEqual(payload.missing, []);
		assert.deepEqual(payload.recommendations, []);
		assert.equal(payload.nextCommand, null);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check rejects unknown arguments", () => {
	const tempDir = makeWorkspace();
	try {
		const result = runCheck(tempDir, ["--unknown"]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Usage: node scripts\/ci\/check-node-substrate\.mjs \[--json\]/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
