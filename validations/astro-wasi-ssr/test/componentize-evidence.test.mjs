import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const evidenceUrl = new URL("../evidence/componentize-attempt.json", import.meta.url);

test("componentization attempt records the current blocker", async () => {
	const evidence = JSON.parse(await readFile(evidenceUrl, "utf8"));

	assert.equal(evidence.status, "blocked");
	assert.equal(evidence.blocker.layer, "wit-resolution");
	assert.equal(evidence.blocker.observedBeforeAstroEvaluation, true);
	assert.match(
		evidence.commands[1].stderrIncludes,
		/package 'wasi:http@0\.2\.3' not found/,
	);
	assert.equal(
		evidence.nextAction,
		"Vendor the official wasi:http WIT dependency graph locally or generate it from a known-good WASI HTTP component, then rerun the componentize script.",
	);
});
