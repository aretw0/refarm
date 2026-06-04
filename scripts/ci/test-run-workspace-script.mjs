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
	assert.deepEqual(
		runPlan(["--with-dependency-builds", "apps/refarm", "test:handoffs"]),
		[
			"pnpm --filter @refarm.dev/refarm... run build",
			"pnpm -C apps/refarm run test:handoffs",
		],
	);
});

test("run-workspace-script rejects dependency builds outside pnpm", () => {
	try {
		runPlan(
			["--with-dependency-builds", "apps/refarm", "test:handoffs"],
			{ REFARM_PACKAGE_MANAGER: "npm" },
		);
		assert.fail("expected --with-dependency-builds to reject non-pnpm managers");
	} catch (error) {
		assert.match(String(error.stderr), /requires pnpm workspace filtering/);
	}
});
