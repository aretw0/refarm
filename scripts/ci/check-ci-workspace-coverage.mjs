#!/usr/bin/env node
/**
 * check-ci-workspace-coverage.mjs
 *
 * Every pnpm workspace ROOT (packages/, apps/, examples/, validations/, templates/, …) must be
 * covered by BOTH:
 *   1. the `code_changes` has_match regex in .github/workflows/test.yml — otherwise a change under
 *      that root leaves code_changes=false and the whole Verify (build/type-check/test/lint) is
 *      SKIPPED for it, and
 *   2. the quality result-cache signature patterns — otherwise a change under that root does not
 *      invalidate the cache, so it rides a stale-green cache hit and its gates never actually run.
 *
 * `examples/` was missing from both, so an examples-only change (e.g. a web face) skipped
 * type-check/test AND rode a stale cache — invisible to CI. This checker makes that class of gap
 * impossible to reintroduce: add a workspace root, and CI fails until it is wired into both places.
 *
 * Pure string/YAML-line parsing, no build. Exit 0 clean, 1 on any uncovered root.
 *
 * Usage: node scripts/ci/check-ci-workspace-coverage.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW = join(ROOT, ".github/workflows/test.yml");
const WORKSPACE = join(ROOT, "pnpm-workspace.yaml");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/** The top-level directory each workspace glob/entry lives under (packages/* → "packages"). */
function workspaceRoots() {
	const text = readFileSync(WORKSPACE, "utf8");
	const lines = text.split("\n");
	const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
	if (start === -1) throw new Error("pnpm-workspace.yaml has no `packages:` list");
	const roots = new Set();
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^\S/.test(line)) break; // dedented out of the packages: block
		const m = line.match(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/);
		if (m) roots.add(m[1].split("/")[0]);
	}
	return [...roots].sort();
}

/** The alternatives of the code_changes has_match regex (the one listing the workspace roots). */
function codeChangesRegexAlternatives(workflow) {
	// The line looks like: if has_match '^(apps/|packages/|examples/|...|tsconfig\.json$)'; then
	const line = workflow.split("\n").find((l) => /has_match\s+'\^\(/.test(l) && l.includes("apps/") && l.includes("packages/"));
	if (!line) throw new Error("could not find the code_changes has_match regex (apps/|packages/…) in test.yml");
	const body = line.match(/'\^\(([^']+)\)'/);
	if (!body) throw new Error("could not parse the code_changes regex body");
	return body[1].split("|").map((a) => a.trim());
}

/** The pattern lines inside the quality-signature heredoc. */
function qualitySignaturePatterns(workflow) {
	const lines = workflow.split("\n");
	const start = lines.findIndex((l) => l.includes("refarm-quality-signature-patterns.txt <<"));
	if (start === -1) throw new Error("could not find the quality-signature heredoc in test.yml");
	const out = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (/^\s*EOF\s*$/.test(lines[i])) break;
		const v = lines[i].trim();
		if (v) out.push(v);
	}
	return out;
}

function main() {
	const roots = workspaceRoots();
	const workflow = readFileSync(WORKFLOW, "utf8");
	const codeChangesAlts = codeChangesRegexAlternatives(workflow);
	const qualityPatterns = qualitySignaturePatterns(workflow);

	const problems = [];
	for (const root of roots) {
		const inCodeChanges = codeChangesAlts.some((a) => a === `${root}/` || a === root);
		const inQuality = qualityPatterns.some((p) => p === root || p === `${root}/` || p.startsWith(`${root}/`));
		if (!inCodeChanges) {
			problems.push(
				`workspace root '${root}/' is NOT in the code_changes regex → an ${root}-only change leaves ` +
					`code_changes=false and SKIPS Verify (build/type-check/test/lint). Add '${root}/' to the ` +
					`has_match '^(apps/|packages/|…)' line in .github/workflows/test.yml.`,
			);
		}
		if (!inQuality) {
			problems.push(
				`workspace root '${root}' is NOT in the quality-signature patterns → an ${root}-only change does ` +
					`not invalidate the quality result-cache and rides a stale-green cache hit. Add '${root}' to the ` +
					`refarm-quality-signature-patterns.txt heredoc in .github/workflows/test.yml.`,
			);
		}
	}

	if (problems.length) {
		console.error(red(`✗ check-ci-workspace-coverage: ${problems.length} uncovered workspace root(s)`));
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
	console.log(green(`✓ check-ci-workspace-coverage: all ${roots.length} workspace roots (${roots.join(", ")}) covered by code_changes + quality signature`));
}

main();
