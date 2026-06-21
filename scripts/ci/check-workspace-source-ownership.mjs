#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listGitTrackedFiles } from "./check-derived-artifact-ownership.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const currentUid =
	typeof process.getuid === "function" ? process.getuid() : null;
const currentUser = os.userInfo().username;

export const defaultSourceOwnershipPatterns = [
	/^apps\/[^/]+\/src\//,
	/^packages\/[^/]+\/src\//,
	/^scripts\//,
	/^validations\/[^/]+\/src\//,
	/^validations\/[^/]+\/[^/]+\/src\//,
];

export function findWorkspaceSourceOwnershipIssues(options = {}) {
	const {
		rootDir = root,
		trackedFiles = listGitTrackedFiles(rootDir),
		patterns = defaultSourceOwnershipPatterns,
		currentUid: expectedUid = currentUid,
		limit = 50,
	} = options;
	if (expectedUid === null) return [];

	const issues = [];
	for (const trackedFile of trackedFiles) {
		if (issues.length >= limit) break;
		const normalized = trackedFile.replaceAll(path.sep, "/");
		if (!patterns.some((pattern) => pattern.test(normalized))) continue;

		const filePath = path.join(rootDir, trackedFile);
		let stat;
		try {
			stat = fs.lstatSync(filePath);
		} catch (error) {
			if (error?.code === "ENOENT") continue;
			throw error;
		}
		if (stat.uid !== expectedUid) {
			issues.push({
				path: normalized,
				uid: stat.uid,
				gid: stat.gid,
			});
		}
	}
	return issues;
}

function main() {
	if (currentUid === null) {
		console.log(
			"[workspace-source-ownership] skipped: current platform does not expose process.getuid()",
		);
		process.exit(0);
	}

	const issues = findWorkspaceSourceOwnershipIssues();
	if (issues.length === 0) {
		console.log(
			`[workspace-source-ownership] ok: tracked source files are owned by ${currentUser} (${currentUid})`,
		);
		process.exit(0);
	}

	console.error(
		`[workspace-source-ownership] found tracked source files not owned by ${currentUser} (${currentUid}).`,
	);
	console.error(
		"[workspace-source-ownership] repair checkout ownership before building or editing source.",
	);
	for (const issue of issues) {
		console.error(`- ${issue.path} uid=${issue.uid} gid=${issue.gid}`);
	}
	process.exit(1);
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	main();
}
