import assert from "node:assert/strict";
import { test } from "node:test";
import { findTrackedArtifacts } from "./check-no-tracked-artifacts.mjs";

test("flags the exact footgun: generated WIT bindings.rs (what main tracked)", () => {
	const offenders = findTrackedArtifacts([
		"packages/heartwood/src/bindings.rs",
		"packages/dispatch-surface-rs/src/bindings.rs",
	]);
	assert.equal(offenders.length, 2);
	assert.ok(offenders.every((o) => o.label === "generated WIT bindings"));
});

test("flags dist / target / node_modules / tsbuildinfo / .turbo", () => {
	const offenders = findTrackedArtifacts([
		"packages/pi-agent/dist/plugin.json",
		"packages/tractor/target/debug/foo",
		"apps/me/node_modules/.vite/x",
		"packages/config/tsconfig.tsbuildinfo",
		"apps/dev/.turbo/turbo-build.log",
	]);
	assert.deepEqual(
		offenders.map((o) => o.label).sort(),
		["dist output", "node_modules", "tsc build info", "turbo cache", "Rust target dir"].sort(),
	);
});

test("compiled wasm is forbidden, but wasm test fixtures are allowed", () => {
	const offenders = findTrackedArtifacts([
		"packages/tractor/build/plugin.wasm", // generated
		"packages/tractor/tests/fixtures/crash-plugin.wasm", // fixture — source
		"packages/tractor-ts/test/__fixtures__/x.wasm", // fixture — source
	]);
	assert.deepEqual(
		offenders.map((o) => o.file),
		["packages/tractor/build/plugin.wasm"],
	);
});

test("legitimate source is NOT flagged (no false positives)", () => {
	const offenders = findTrackedArtifacts([
		"packages/config/src/index.d.ts", // hand-written .d.ts in a JS-atomic package
		"packages/config/src/index.js",
		"apps/refarm/src/commands/dist.ts", // 'dist' in the FILENAME, not a dist/ dir
		"scripts/ci/check-no-tracked-artifacts.mjs",
		"packages/tractor/src/host/bindings_helper.rs", // not literally bindings.rs
		"packages/tractor/tests/fixtures/http-plugin/src/bindings.rs", // fixture plugin — source
	]);
	assert.deepEqual(offenders, []);
});
