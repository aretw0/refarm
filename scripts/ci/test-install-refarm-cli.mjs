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
