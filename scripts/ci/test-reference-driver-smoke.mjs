import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const SCRIPT = "scripts/ci/reference-driver-smoke.mjs";

test("prints an ordered reference-driver smoke plan", () => {
	const output = execFileSync(process.execPath, [SCRIPT, "--plan"], {
		encoding: "utf8",
	});

	const lines = output.trim().split("\n");
	assert.deepEqual(lines, [
		"worker-profile: pnpm -C packages/cli run test:worker-profile",
		"structured-io: cargo test --manifest-path packages/agent-tools/Cargo.toml --lib structured_io --quiet",
		"session-tree: pnpm -C apps/refarm run test:tree-reference-driver",
		"code-ops-wit: pnpm -C packages/pi-agent run check:wit",
		"code-ops: cargo test --manifest-path packages/tractor/Cargo.toml --lib code_ops --quiet -- --test-threads=1",
	]);
});
