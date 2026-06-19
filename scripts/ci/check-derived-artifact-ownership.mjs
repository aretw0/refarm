#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
const currentUser = os.userInfo().username;

export const defaultArtifactRoots = [
	".turbo",
	"apps/dev/dist",
	"apps/me/dist",
	"apps/refarm/dist",
	"apps/dev/node_modules/.vite",
	"apps/me/node_modules/.vite",
	"apps/refarm/node_modules/.vite",
	"validations/sqlite-benchmark/browser/dist",
	"validations/wasm-plugin/host/dist",
	"validations/wasm-plugin/host/node_modules/.vite",
];

export const defaultTrackedDerivedArtifactPatterns = [
	/^validations\/sqlite-benchmark\/browser\/public\/sqlite3/,
	/^validations\/sqlite-benchmark\/browser\/public\/sql-wasm.*\.wasm$/,
];

export function walkArtifacts(dir, issues, options = {}) {
	const { rootDir = root, currentUid: expectedUid = currentUid, limit = 50 } = options;
	if (issues.length >= limit) return;
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return;
		throw error;
	}

	for (const entry of entries) {
		if (issues.length >= limit) return;
		const entryPath = path.join(dir, entry.name);
		const stat = fs.lstatSync(entryPath);
		if (expectedUid !== null && stat.uid !== expectedUid) {
			issues.push({
				path: path.relative(rootDir, entryPath),
				uid: stat.uid,
				gid: stat.gid,
			});
		}
		if (entry.isDirectory()) walkArtifacts(entryPath, issues, options);
	}
}

export function listGitTrackedFiles(rootDir = root) {
	try {
		return execFileSync("git", ["ls-files"], {
			cwd: rootDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		})
			.split(/\r?\n/)
			.filter(Boolean);
	} catch (error) {
		throw new Error(`failed to list git tracked files: ${error.message}`);
	}
}

export function findTrackedDerivedArtifactIssues(options = {}) {
	const {
		rootDir = root,
		trackedFiles = listGitTrackedFiles(rootDir),
		patterns = defaultTrackedDerivedArtifactPatterns,
	} = options;
	return trackedFiles
		.map((file) => file.replaceAll(path.sep, "/"))
		.filter((file) => patterns.some((pattern) => pattern.test(file)))
		.map((file) => ({ path: file }));
}

export function findDerivedArtifactOwnershipIssues(options = {}) {
	const {
		rootDir = root,
		artifactRoots = defaultArtifactRoots,
		currentUid: expectedUid = currentUid,
		limit = 50,
	} = options;
	const issues = [];
	for (const artifactRoot of artifactRoots) {
		walkArtifacts(path.join(rootDir, artifactRoot), issues, {
			rootDir,
			currentUid: expectedUid,
			limit,
		});
	}
	return issues;
}

function main() {
	const trackedIssues = findTrackedDerivedArtifactIssues();
	if (trackedIssues.length > 0) {
		console.error("[derived-artifact-ownership] found generated artifacts tracked by git.");
		console.error("[derived-artifact-ownership] keep generated validation assets ignored and created by setup scripts.");
		for (const issue of trackedIssues) {
			console.error(`- ${issue.path}`);
		}
		process.exit(1);
	}

	if (currentUid === null) {
		console.log("[derived-artifact-ownership] skipped: current platform does not expose process.getuid()");
		process.exit(0);
	}

	const issues = findDerivedArtifactOwnershipIssues();
	if (issues.length === 0) {
		console.log(`[derived-artifact-ownership] ok: derived artifacts are owned by ${currentUser} (${currentUid})`);
		process.exit(0);
	}

	console.error(
		`[derived-artifact-ownership] found derived artifacts not owned by ${currentUser} (${currentUid}).`,
	);
	console.error("[derived-artifact-ownership] clean the affected ignored outputs in the environment that owns them.");
	for (const issue of issues) {
		console.error(`- ${issue.path} uid=${issue.uid} gid=${issue.gid}`);
	}
	process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main();
}
