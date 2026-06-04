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

test("run-workspace-script plans a plain workspace command", () => {
	assert.deepEqual(runPlan(["apps/refarm", "test:handoffs"]), [
		"pnpm -C apps/refarm run test:handoffs",
	]);
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
	assert(!lines.some((line) => line.includes("packages/pi-agent")));
	assert(!lines.some((line) => line.includes("packages/heartwood")));
	assert(!lines.some((line) => line.includes("packages/storage-memory")));
});
