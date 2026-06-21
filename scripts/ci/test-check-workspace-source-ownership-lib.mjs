#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findWorkspaceSourceOwnershipIssues } from "./check-workspace-source-ownership.mjs";

function withTempRoot(fn) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-source-ownership-"));
	try {
		return fn(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

test("reports tracked source files whose uid differs from the expected workspace uid", () =>
	withTempRoot((root) => {
		const sourcePath = path.join(root, "packages/health/src/index.js");
		fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
		fs.writeFileSync(sourcePath, "export {};\n");

		const actualUid = fs.lstatSync(sourcePath).uid;
		const issues = findWorkspaceSourceOwnershipIssues({
			rootDir: root,
			trackedFiles: ["packages/health/src/index.js"],
			currentUid: actualUid + 1,
		});

		assert.deepEqual(issues, [
			{
				path: "packages/health/src/index.js",
				uid: actualUid,
				gid: fs.lstatSync(sourcePath).gid,
			},
		]);
	}));

test("ignores tracked files outside source ownership roots", () =>
	withTempRoot((root) => {
		const readmePath = path.join(root, "README.md");
		fs.writeFileSync(readmePath, "# Refarm\n");

		const actualUid = fs.lstatSync(readmePath).uid;
		assert.deepEqual(
			findWorkspaceSourceOwnershipIssues({
				rootDir: root,
				trackedFiles: ["README.md"],
				currentUid: actualUid + 1,
			}),
			[],
		);
	}));

test("limits the number of reported source ownership issues", () =>
	withTempRoot((root) => {
		const first = path.join(root, "apps/refarm/src/a.ts");
		const second = path.join(root, "apps/refarm/src/b.ts");
		fs.mkdirSync(path.dirname(first), { recursive: true });
		fs.writeFileSync(first, "export {};\n");
		fs.writeFileSync(second, "export {};\n");

		const actualUid = fs.lstatSync(first).uid;
		const issues = findWorkspaceSourceOwnershipIssues({
			rootDir: root,
			trackedFiles: ["apps/refarm/src/a.ts", "apps/refarm/src/b.ts"],
			currentUid: actualUid + 1,
			limit: 1,
		});

		assert.equal(issues.length, 1);
		assert.equal(issues[0].path, "apps/refarm/src/a.ts");
	}));
