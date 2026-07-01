import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const evidenceUrl = new URL("../evidence/componentize-attempt.json", import.meta.url);
const witDeps = [
	"../wit/deps/http/package.wit",
	"../wit/deps/http/types.wit",
	"../wit/deps/http/handler.wit",
	"../wit/deps/io/error.wit",
	"../wit/deps/io/poll.wit",
	"../wit/deps/io/streams.wit",
	"../wit/deps/clocks/monotonic-clock.wit",
	"../wit/deps/clocks/wall-clock.wit",
];

test("componentization attempt records the current blocker", async () => {
	const evidence = JSON.parse(await readFile(evidenceUrl, "utf8"));

	assert.equal(evidence.status, "blocked");
	assert.equal(evidence.resolved[0].layer, "wit-resolution");
	assert.equal(evidence.blocker.layer, "astro-server-bundle-node-surface");
	assert.equal(evidence.blocker.observedAfterWitResolution, true);
	assert.equal(evidence.decision.partC, "red");
	assert.equal(evidence.commands[2].exitCode, 1);
	assert.match(evidence.commands[2].stderrIncludes, /Error loading module "node:module"/);
	assert.match(evidence.commands[3].result, /node:module/);
	assert.equal(
		evidence.nextAction,
		"Keep ADR-070 Parts A/B as the active WASM substrate direction; revisit Astro-on-Tractor only if a second consumer or upstream Astro WASI bundle profile changes the cost model.",
	);
});

test("componentization fixture vendors the resolved WIT dependency graph", async () => {
	await Promise.all(
		witDeps.map((path) => access(new URL(path, import.meta.url))),
	);
});
