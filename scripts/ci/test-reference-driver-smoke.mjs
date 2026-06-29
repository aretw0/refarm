import assert from "node:assert/strict";
import test from "node:test";
import { buildReferenceDriverSmokePlan } from "./reference-driver-smoke.mjs";

test("prints an ordered reference-driver smoke plan", () => {
	const lines = buildReferenceDriverSmokePlan().map(
		(step) => `${step.id}: ${step.display}`,
	);
	assert.deepEqual(lines, [
		"ask-loop: pnpm -C apps/refarm run test:ask-reference-driver",
		"reference-driver-sdk: pnpm -C packages/cli run test:reference-driver-sdk",
		"structured-io: cargo test --manifest-path packages/agent-tools/Cargo.toml --lib structured_io --quiet",
		"session-tree: pnpm -C apps/refarm run test:tree-reference-driver",
		"code-ops-wit: pnpm -C packages/pi-agent run check:wit",
		"code-ops: cargo test --manifest-path packages/tractor/Cargo.toml --lib code_ops --quiet -- --test-threads=1",
	]);
});
