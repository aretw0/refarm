import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
	buildRepoComplexityReport,
	scanFiles,
} from "../repo-complexity-check.mjs";

describe("repo-complexity-check", () => {
	it("reports source files above the configured line budget", () => {
		const root = mkdtempSync(path.join(tmpdir(), "refarm-complexity-"));
		try {
			writeFileSync(path.join(root, "small.ts"), "one\ntwo\n", "utf8");
			writeFileSync(path.join(root, "large.ts"), "one\ntwo\nthree\nfour\n", "utf8");

			const findings = scanFiles(["small.ts", "large.ts"], 3, { cwd: root });

			assert.deepEqual(findings, [
				{
					category: "other",
					file: "large.ts",
					lines: 4,
					size: 19,
					note: "over-limit",
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("marks lockfiles, fixtures, project state, and vendored artifacts as allowed large files", () => {
		const root = mkdtempSync(path.join(tmpdir(), "refarm-complexity-"));
		try {
			mkdirSync(path.join(root, ".project"), { recursive: true });
			mkdirSync(path.join(root, "test", "fixtures"), { recursive: true });
			mkdirSync(path.join(root, "public"), { recursive: true });
			writeFileSync(path.join(root, "pnpm-lock.yaml"), "a\nb\nc\nd\n", "utf8");
			writeFileSync(path.join(root, ".project", "tasks.json"), "a\nb\nc\nd\n", "utf8");
			writeFileSync(
				path.join(root, "test", "fixtures", "payload.json"),
				"a\nb\nc\nd\n",
				"utf8",
			);
			writeFileSync(
				path.join(root, "public", "sqlite3-worker1.mjs"),
				"a\nb\nc\nd\n",
				"utf8",
			);

			const findings = scanFiles([
				"pnpm-lock.yaml",
				".project/tasks.json",
				"test/fixtures/payload.json",
				"public/sqlite3-worker1.mjs",
			], 3, { cwd: root }).sort((a, b) => a.file.localeCompare(b.file));

			assert.deepEqual(findings.map((finding) => finding.note), [
				"allowed:project-state",
				"allowed:lock-or-history",
				"allowed:vendored-artifact",
				"allowed:fixture",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("builds an ok=false report when blocking files exceed the budget", () => {
		const root = mkdtempSync(path.join(tmpdir(), "refarm-complexity-"));
		try {
			writeFileSync(path.join(root, "large.ts"), "one\ntwo\nthree\nfour\n", "utf8");

			const report = buildRepoComplexityReport(root, {
				files: ["large.ts"],
				maxLines: 3,
			});

			assert.equal(report.ok, false);
			assert.equal(report.blockingFindings.length, 1);
			assert.equal(report.blockingFindings[0].file, "large.ts");
			assert.equal(report.reportLimit, 10);
			assert.deepEqual(report.topBlockingFindings, report.blockingFindings);
			assert.deepEqual(report.topFindings, report.findings);
			assert.deepEqual(report.summaryByCategory, {
				other: {
					allowed: 0,
					blocking: 1,
					files: 1,
					maxLines: 4,
					totalLines: 4,
				},
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps full findings while exposing bounded top findings", () => {
		const root = mkdtempSync(path.join(tmpdir(), "refarm-complexity-"));
		try {
			for (const file of ["a.ts", "b.ts", "c.ts"]) {
				writeFileSync(path.join(root, file), "one\ntwo\nthree\nfour\n", "utf8");
			}

			const report = buildRepoComplexityReport(root, {
				files: ["a.ts", "b.ts", "c.ts"],
				limit: 2,
				maxLines: 3,
			});

			assert.equal(report.findings.length, 3);
			assert.equal(report.blockingFindings.length, 3);
			assert.equal(report.reportLimit, 2);
			assert.deepEqual(report.topFindings.map((finding) => finding.file), ["a.ts", "b.ts"]);
			assert.deepEqual(report.topBlockingFindings.map((finding) => finding.file), [
				"a.ts",
				"b.ts",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("classifies test, docs, scripts, and source findings", () => {
		const root = mkdtempSync(path.join(tmpdir(), "refarm-complexity-"));
		try {
			const files = [
				"apps/refarm/src/commands/agent.ts",
				"apps/refarm/test/commands/agent.test.ts",
				"docs/OPERATOR_PRIMITIVES.md",
				"scripts/repo-complexity-check.mjs",
			];
			for (const file of files) {
				mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
				writeFileSync(path.join(root, file), "one\ntwo\nthree\nfour\n", "utf8");
			}

			const report = buildRepoComplexityReport(root, { files, maxLines: 3 });

			assert.deepEqual(Object.keys(report.summaryByCategory), [
				"docs",
				"script",
				"source",
				"test",
			]);
			assert.deepEqual(report.findings.map((finding) => finding.category).sort(), [
				"docs",
				"script",
				"source",
				"test",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
