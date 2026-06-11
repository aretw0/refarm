import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve("scripts/install-refarm-cli.mjs");

function runInstall(args = [], env = {}) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: path.resolve("."),
		encoding: "utf8",
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
}

test("install-refarm-cli dry-run reports planned shims without writing", () => {
	const binDir = mkdtempSync(path.join(tmpdir(), "refarm-cli-install-test-"));
	try {
		const result = runInstall(["--dry-run"], {
			REFARM_CLI_BIN_DIR: binDir,
		});

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /\[install-refarm-cli\]\[dry-run\] would install refarm shim -> /);
		assert.match(result.stdout, /Next: refarm check --next-action --json/);
		assert.equal(existsSync(path.join(binDir, "refarm")), false);
		assert.equal(existsSync(path.join(binDir, "refarm.cmd")), false);
	} finally {
		rmSync(binDir, { recursive: true, force: true });
	}
});

test("install-refarm-cli dry-run can emit a machine-readable handoff", () => {
	const binDir = mkdtempSync(path.join(tmpdir(), "refarm-cli-install-test-"));
	try {
		const result = runInstall(["--dry-run", "--build", "--json"], {
			REFARM_CLI_BIN_DIR: binDir,
		});

		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.doesNotMatch(result.stdout, /\[install-refarm-cli\]/);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, true);
		assert.equal(payload.command, "install-refarm-cli");
		assert.equal(payload.dryRun, true);
		assert.equal(payload.forceBuild, true);
		assert.equal(payload.binDir, binDir);
		assert.equal(payload.build.required, true);
		assert.equal(payload.build.process.display, "pnpm -C apps/refarm run build");
		assert.equal(payload.shims.posix, path.join(binDir, "refarm"));
		assert.equal(payload.nextCommand, "refarm check --next-action --json");
		assert.deepEqual(payload.nextCommands, ["refarm check --next-action --json"]);
		assert.equal(existsSync(path.join(binDir, "refarm")), false);
	} finally {
		rmSync(binDir, { recursive: true, force: true });
	}
});

test("install-refarm-cli prints help without installing", () => {
	const result = runInstall(["--help"]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Usage: node scripts\/install-refarm-cli\.mjs/);
	assert.match(result.stdout, /--dry-run/);
	assert.match(result.stdout, /--json/);
});

test("install-refarm-cli rejects unknown arguments", () => {
	const result = runInstall(["--wat"]);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Unknown argument\(s\): --wat/);
	assert.match(result.stderr, /Usage: node scripts\/install-refarm-cli\.mjs/);
});

test("install-refarm-cli rejects unknown arguments as json", () => {
	const result = runInstall(["--wat", "--json"]);

	assert.notEqual(result.status, 0);
	assert.equal(result.stderr, "");

	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, false);
	assert.equal(payload.command, "install-refarm-cli");
	assert.equal(payload.error, "unknown-argument");
	assert.match(payload.message, /Unknown argument\(s\): --wat/);
	assert.equal(payload.nextCommand, null);
	assert.deepEqual(payload.nextCommands, []);
});
