import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
	MINIMUM_PLAUSIBLE_WORKFLOW_FILE_COUNT,
	evaluateActionPins,
	listYamlFiles,
} from "./check-github-action-pins.mjs";

function readFakeFile(file) {
	// evaluateActionPins is called with plain { rel, full } objects in
	// production; the test's injected reader keys off `full` the same way
	// readFileSync would, using a lookup instead of the real filesystem.
	throw new Error(`unexpected real read for ${file}`);
}

function makeReader(contentsByFull) {
	return (full) => {
		if (!(full in contentsByFull)) throw new Error(`no fixture content for ${full}`);
		return contentsByFull[full];
	};
}

function plausibleWorkflowFiles(count = MINIMUM_PLAUSIBLE_WORKFLOW_FILE_COUNT) {
	return Array.from({ length: count }, (_, i) => ({
		rel: `.github/workflows/w${i}.yml`,
		full: `.github/workflows/w${i}.yml`,
	}));
}

describe("check-github-action-pins", () => {
	it("reports a coverage error instead of a silent clean pass when the workflow scan comes up empty", () => {
		// The exact shape of the original defect: if listYamlFiles found the wrong
		// directory (renamed, permission-denied, or otherwise), workflowFiles is
		// empty, the violations loop never runs, and the pre-fix code reported
		// "✓ pinned" over zero real coverage.
		const result = evaluateActionPins(
			{ workflowFiles: [], actionFiles: [], templateFiles: [] },
			readFakeFile,
		);

		assert.equal(result.ok, false);
		assert.deepEqual(result.violations, []);
		assert.match(result.coverageError, /found only 0 YAML file/);
	});

	it("still reports a coverage error below the plausibility floor even with some files found", () => {
		const files = plausibleWorkflowFiles(MINIMUM_PLAUSIBLE_WORKFLOW_FILE_COUNT - 1);
		const contents = Object.fromEntries(files.map((f) => [f.full, "on: push\n"]));

		const result = evaluateActionPins(
			{ workflowFiles: files, actionFiles: [], templateFiles: [] },
			makeReader(contents),
		);

		assert.equal(result.ok, false);
		assert.match(result.coverageError, /found only \d+ YAML file/);
	});

	it("scans normally and finds no violations once the floor is met and every ref is pinned", () => {
		const files = plausibleWorkflowFiles();
		const validSha = "a".repeat(40);
		const contents = Object.fromEntries(
			files.map((f) => [f.full, `steps:\n  - name: Checkout\n    uses: actions/checkout@${validSha}\n`]),
		);

		const result = evaluateActionPins(
			{ workflowFiles: files, actionFiles: [], templateFiles: [] },
			makeReader(contents),
		);

		assert.equal(result.ok, true);
		assert.equal(result.coverageError, null);
		assert.deepEqual(result.violations, []);
	});

	it("flags an unpinned third-party action once the floor is met", () => {
		const files = plausibleWorkflowFiles();
		const contents = Object.fromEntries(files.map((f) => [f.full, "on: push\n"]));
		contents[files[0].full] = "steps:\n  - name: Checkout\n    uses: actions/checkout@v4\n";

		const result = evaluateActionPins(
			{ workflowFiles: files, actionFiles: [], templateFiles: [] },
			makeReader(contents),
		);

		assert.equal(result.ok, false);
		assert.equal(result.coverageError, null);
		assert.equal(result.violations.length, 1);
		assert.equal(result.violations[0].reason, "ref is not a full 40-character SHA");
	});

	it("listYamlFiles returns an empty list for a missing directory instead of throwing", () => {
		const tempRoot = mkdtempSync(path.join(os.tmpdir(), "refarm-action-pins-"));
		try {
			const missing = path.join(tempRoot, "does-not-exist");
			assert.deepEqual(listYamlFiles(missing), []);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("listYamlFiles finds nested yaml files under a real directory", () => {
		const tempRoot = mkdtempSync(path.join(os.tmpdir(), "refarm-action-pins-"));
		try {
			mkdirSync(path.join(tempRoot, "nested"), { recursive: true });
			writeFileSync(path.join(tempRoot, "top.yml"), "on: push\n");
			writeFileSync(path.join(tempRoot, "nested", "child.yaml"), "on: push\n");
			writeFileSync(path.join(tempRoot, "ignored.txt"), "not yaml");

			const found = listYamlFiles(tempRoot).map((f) => f.rel).sort();
			assert.deepEqual(found, ["nested/child.yaml", "top.yml"]);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
