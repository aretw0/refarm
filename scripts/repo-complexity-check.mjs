#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_COMPLEXITY_LINES = 1000;
export const DEFAULT_COMPLEXITY_REPORT_LIMIT = 10;

const DEFAULT_EXTENSIONS = new Set([
	".cjs",
	".js",
	".jsx",
	".json",
	".md",
	".mjs",
	".rs",
	".ts",
	".tsx",
	".yaml",
	".yml",
]);

const ALLOWED_BASENAMES = new Set([
	"CHANGELOG.md",
	"pnpm-lock.yaml",
	"package-lock.json",
	"yarn.lock",
]);

function normalizePath(value) {
	return value.replace(/\\/g, "/");
}

function isAllowedLargeFile(file) {
	const normalized = normalizePath(file);
	const basename = path.basename(normalized);
	if (ALLOWED_BASENAMES.has(basename)) return "allowed:lock-or-history";
	if (normalized.startsWith(".project/")) return "allowed:project-state";
	if (normalized.includes("/fixtures/")) return "allowed:fixture";
	if (
		normalized.startsWith("public/sqlite3-") ||
		normalized.includes("/public/sqlite3-")
	) {
		return "allowed:vendored-artifact";
	}
	return null;
}

function classifyFile(file) {
	const normalized = normalizePath(file);
	if (normalized.startsWith(".project/")) return "project-state";
	if (normalized.includes("/fixtures/")) return "fixture";
	if (normalized.includes("/test/") || normalized.includes(".test.")) return "test";
	if (
		normalized.startsWith("docs/") ||
		normalized.startsWith("specs/") ||
		normalized.endsWith(".md")
	) {
		return "docs";
	}
	if (normalized.startsWith("scripts/")) return "script";
	if (
		normalized.startsWith("apps/") ||
		normalized.startsWith("packages/") ||
		normalized.startsWith("validations/")
	) {
		return "source";
	}
	return "other";
}

function countLines(text) {
	if (text.length === 0) return 0;
	return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

export function scanFiles(files, maxLines = DEFAULT_MAX_COMPLEXITY_LINES, options = {}) {
	const cwd = options.cwd ?? process.cwd();
	return files.flatMap((file) => {
		const absolute = path.isAbsolute(file) ? file : path.join(cwd, file);
		const relativeFile = normalizePath(path.relative(cwd, absolute) || file);
		const ext = path.extname(relativeFile);
		if (!DEFAULT_EXTENSIONS.has(ext)) return [];
		const stat = statSync(absolute, { throwIfNoEntry: false });
		if (!stat?.isFile()) return [];
		const lines = countLines(readFileSync(absolute, "utf8"));
		if (lines <= maxLines) return [];
		const allowed = isAllowedLargeFile(relativeFile);
		return [{
			category: classifyFile(relativeFile),
			file: relativeFile,
			lines,
			size: stat.size,
			note: allowed ?? "over-limit",
		}];
	});
}

function gitLines(cwd, args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	})
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function trackedFiles(cwd) {
	return gitLines(cwd, ["ls-files"]);
}

function changedFiles(cwd, base) {
	return gitLines(cwd, ["diff", "--name-only", "--diff-filter=ACMR", base, "--"]);
}

function summarizeFindingsByCategory(findings) {
	return Object.fromEntries(
		Object.entries(
			findings.reduce((summary, finding) => {
				const current = summary[finding.category] ?? {
					allowed: 0,
					blocking: 0,
					files: 0,
					maxLines: 0,
					totalLines: 0,
				};
				current.files += 1;
				current.totalLines += finding.lines;
				current.maxLines = Math.max(current.maxLines, finding.lines);
				if (finding.note.startsWith("allowed:")) current.allowed += 1;
				else current.blocking += 1;
				return { ...summary, [finding.category]: current };
			}, {}),
		).sort(([left], [right]) => left.localeCompare(right)),
	);
}

export function buildRepoComplexityReport(cwd = process.cwd(), options = {}) {
	const maxLines = options.maxLines ?? DEFAULT_MAX_COMPLEXITY_LINES;
	const limit = options.limit ?? DEFAULT_COMPLEXITY_REPORT_LIMIT;
	const files = options.files ?? (options.changed
		? changedFiles(cwd, options.base ?? "HEAD")
		: trackedFiles(cwd));
	const findings = scanFiles(files, maxLines, { cwd })
		.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
	const blockingFindings = findings.filter((finding) => !finding.note.startsWith("allowed:"));
	const allowedFindings = findings.filter((finding) => finding.note.startsWith("allowed:"));
	return {
		ok: blockingFindings.length === 0,
		maxLines,
		scope: options.changed ? "changed" : "tracked",
		base: options.changed ? options.base ?? "HEAD" : null,
		totalFindings: findings.length,
		blockingFindings,
		allowedFindings,
		reportLimit: limit,
		topBlockingFindings: blockingFindings.slice(0, limit),
		topFindings: findings.slice(0, limit),
		summaryByCategory: summarizeFindingsByCategory(findings),
		findings,
	};
}

function parseArgs(argv) {
	const options = {
		base: "HEAD",
		changed: false,
		help: false,
		json: false,
		limit: DEFAULT_COMPLEXITY_REPORT_LIMIT,
		maxLines: DEFAULT_MAX_COMPLEXITY_LINES,
		strict: false,
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--base") {
			const value = argv[++index]?.trim();
			if (!value) throw new Error("--base requires a value");
			options.base = value;
		} else if (arg === "--changed") {
			options.changed = true;
		} else if (arg === "--help" || arg === "-h") {
			options.help = true;
		} else if (arg === "--json") {
			options.json = true;
		} else if (arg === "--limit") {
			const value = Number(argv[++index]);
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error("--limit requires a positive number");
			}
			options.limit = Math.floor(value);
		} else if (arg === "--max-lines") {
			const value = Number(argv[++index]);
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error("--max-lines requires a positive number");
			}
			options.maxLines = Math.floor(value);
		} else if (arg === "--strict") {
			options.strict = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MiB`;
}

function printHelp() {
	console.log([
		"repo-complexity-check",
		"",
		"Usage:",
		"  node scripts/repo-complexity-check.mjs",
		"  node scripts/repo-complexity-check.mjs --max-lines 800 --strict",
		"  node scripts/repo-complexity-check.mjs --changed --base HEAD --json",
		"  node scripts/repo-complexity-check.mjs --limit 5",
	].join("\n"));
}

function printReport(report) {
	if (report.blockingFindings.length === 0) {
		console.log(`complexity-check: OK (${report.totalFindings} large allowed file(s), max=${report.maxLines})`);
	} else {
		console.log(`complexity-check: ${report.blockingFindings.length} blocking file(s) over ${report.maxLines} lines`);
	}
	const displayedFindings = report.blockingFindings.length > 0
		? report.topBlockingFindings
		: report.topFindings;
	for (const finding of displayedFindings) {
		console.log(`  - ${finding.file} | category=${finding.category} | lines=${finding.lines} | size=${formatBytes(finding.size)} | ${finding.note}`);
	}
	const hiddenCount = report.blockingFindings.length > 0
		? report.blockingFindings.length - displayedFindings.length
		: report.findings.length - displayedFindings.length;
	if (hiddenCount > 0) {
		console.log(`  ... (+${hiddenCount} more)`);
	}
}

function main() {
	let options;
	try {
		options = parseArgs(process.argv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	if (options.help) {
		printHelp();
		return;
	}
	const report = buildRepoComplexityReport(process.cwd(), options);
	if (options.json) console.log(JSON.stringify(report, null, 2));
	else printReport(report);
	if (options.strict && !report.ok) process.exit(2);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
	main();
}
