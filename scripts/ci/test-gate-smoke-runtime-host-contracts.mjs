#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("runtime host-contract smoke builds sower's windmill dependency first", () => {
	const result = spawnSync(process.execPath, ["scripts/ci/gate-smoke-runtime-host-contracts.mjs", "--plan"], {
		encoding: "utf8",
		windowsHide: true,
	});

	assert.equal(result.status, 0, result.stderr);
	const lines = result.stdout.trim().split(/\r?\n/);
	const windmill = lines.indexOf("pnpm -C packages/windmill run build");
	const sower = lines.indexOf("pnpm -C packages/sower run build");
	assert.ok(windmill >= 0, "windmill must be built by the host-contract gate");
	assert.ok(sower >= 0, "sower must be built by the host-contract gate");
	assert.ok(windmill < sower, "windmill must be built before sower");
});
