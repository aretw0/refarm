#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("runtime smoke gate routes WebSocket smoke through the tractor workspace", () => {
	const result = spawnSync(process.execPath, ["scripts/ci/gate-smoke-runtime.mjs", "--plan"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});

	assert.equal(result.status, 0);
	assert.equal(result.stderr, "");

	const lines = result.stdout.trim().split(/\r?\n/);
	assert.ok(lines.includes("pnpm -C packages/tractor run test:smoke:ws"));
	assert.equal(lines.includes("pnpm run test:smoke:ws"), false);
});
