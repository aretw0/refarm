#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	findDerivedArtifactOwnershipIssues,
	findTrackedDerivedArtifactIssues,
} from "./check-derived-artifact-ownership.mjs";

function withTempRoot(fn) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-artifact-ownership-"));
	try {
		return fn(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

test("ignores missing artifact roots", () =>
	withTempRoot((root) => {
		assert.deepEqual(
			findDerivedArtifactOwnershipIssues({
				rootDir: root,
				artifactRoots: ["missing/dist"],
				currentUid: typeof process.getuid === "function" ? process.getuid() : null,
			}),
			[],
		);
	}));

test("reports derived artifacts whose uid differs from the expected workspace uid", () =>
	withTempRoot((root) => {
		const artifactPath = path.join(root, "app/dist/index.js");
		fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
		fs.writeFileSync(artifactPath, "console.log('derived');\n");

		const actualUid = fs.lstatSync(artifactPath).uid;
		const issues = findDerivedArtifactOwnershipIssues({
			rootDir: root,
			artifactRoots: ["app/dist"],
			currentUid: actualUid + 1,
		});

		assert.deepEqual(issues, [
			{
				path: "app/dist/index.js",
				uid: actualUid,
				gid: fs.lstatSync(artifactPath).gid,
			},
		]);
	}));

test("limits the number of reported ownership issues", () =>
	withTempRoot((root) => {
		const artifactDir = path.join(root, "cache");
		fs.mkdirSync(artifactDir, { recursive: true });
		fs.writeFileSync(path.join(artifactDir, "a"), "a");
		fs.writeFileSync(path.join(artifactDir, "b"), "b");

		const actualUid = fs.lstatSync(artifactDir).uid;
		const issues = findDerivedArtifactOwnershipIssues({
			rootDir: root,
			artifactRoots: ["cache"],
			currentUid: actualUid + 1,
			limit: 1,
		});

		assert.equal(issues.length, 1);
		assert.equal(issues[0].path, "cache/a");
	}));

test("reports tracked generated validation assets at the suite root", () => {
	assert.deepEqual(
		findTrackedDerivedArtifactIssues({
			trackedFiles: [
				"validations/sqlite-benchmark/browser/public/sqlite3-worker1.mjs",
				"validations/sqlite-benchmark/browser/public/favicon.svg",
			],
		}),
		[
			{
				path: "validations/sqlite-benchmark/browser/public/sqlite3-worker1.mjs",
			},
		],
	);
});

test("ignores regular tracked public validation assets", () => {
	assert.deepEqual(
		findTrackedDerivedArtifactIssues({
			trackedFiles: [
				"validations/sqlite-benchmark/browser/public/favicon.svg",
				"validations/sqlite-benchmark/browser/src/main.ts",
			],
		}),
		[],
	);
});
