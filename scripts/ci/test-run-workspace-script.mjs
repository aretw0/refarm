import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function runPlan(args, env = {}) {
	return execFileSync(
		process.execPath,
		["scripts/ci/run-workspace-script.mjs", "--plan", ...args],
		{
			encoding: "utf8",
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		},
	).trim().split(/\r?\n/);
}

function runRootPlan(args, env = {}) {
	return execFileSync(
		process.execPath,
		["scripts/ci/run-root-scripts.mjs", "--plan", ...args],
		{
			encoding: "utf8",
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		},
	).trim().split(/\r?\n/);
}

test("run-workspace-script plans a plain workspace command", () => {
	assert.deepEqual(runPlan(["apps/refarm", "test:handoffs"]), [
		"pnpm -C apps/refarm run test:handoffs",
	]);
});

test("run-root-scripts plans spawn-safe root package scripts", () => {
	assert.deepEqual(
		runRootPlan(["validation-pocs:test"], { REFARM_PACKAGE_MANAGER: "pnpm" }),
		["pnpm -C . run validation-pocs:test"],
	);
});

test("run-workspace-script plans dependency builds before the workspace command", () => {
	const lines = runPlan([
		"--with-dependency-builds",
		"apps/refarm",
		"test:handoffs",
	]);

	assert(lines.includes("pnpm -C packages/health run build"));
	assert(lines.includes("pnpm -C packages/cli run build"));
	assert.equal(lines.at(-1), "pnpm -C apps/refarm run test:handoffs");
	assert(!lines.some((line) => line.includes("\\")));
	assert(!lines.some((line) => line.includes("packages/pi-agent")));
	assert(!lines.some((line) => line.includes("packages/heartwood")));
	assert(!lines.some((line) => line.includes("packages/storage-memory")));
});
