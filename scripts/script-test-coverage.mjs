#!/usr/bin/env node
/**
 * A CEILING ON HOW MUCH OF `scripts/` NOBODY TESTS.
 *
 * ## Why this exists
 *
 * `scripts/` is this repository's second largest surface — 189 production files, 43,015 lines,
 * larger than every package and 14x `packages/toolbox/src`. `repo-complexity-check.mjs` gates
 * FILE LENGTH and nothing gates the untested fraction, so it could only ever grow (ISS-106).
 *
 * The fraction has improved on its own — 70% untested when the item was filed, 60% now — which is
 * exactly why a ceiling is worth taking now rather than later: a number that is moving in the
 * right direction is a number worth stopping from moving back.
 *
 * ## "Tested" means THE LANE WOULD RUN SOMETHING FOR IT
 *
 * Not "a file with a similar name exists". This asks `suitesForChangedPaths` — the same function
 * `refarm agent finish` uses to decide which suites an edit wakes — so a file counts as covered
 * exactly when changing it would cause a suite to run. One definition, not two that agree today.
 *
 * That also makes the ratchet honest about its own blind spot: a suite that exists but which the
 * runner would never select for that file is NOT coverage, because nothing would ever run it on
 * account of that file.
 *
 * ## The ceiling is a measurement, not a target
 *
 * It ships at today's number with delta 0, like every other ratchet here. It can only go down, and
 * lowering it is the ordinary way a slice records that it left the repository better than it found
 * it.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { suitesForChangedPaths } from "./ci/run-script-tests.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Files under `scripts/` that no suite would be run for, measured 2026-08-12.
 *
 * NEVER RAISE THIS TO MAKE A RUN PASS. A new script with no suite is the thing this exists to
 * refuse; raising the ceiling to admit one turns the gate into a formality. The two honest moves
 * are to write the suite, or to say in the commit why this file is not the kind of thing that has
 * one — and take the number down when a slice covers something.
 */
export const BASELINE_MAX_UNCOVERED = 113;

/** PURE. Is this a production script rather than a suite? A suite is named for what it tests, by
 *  the convention the runner matches on: `<name>.test.mjs` or `test-<name>.mjs`. */
export function isProductionScript(file) {
	const base = path.basename(file);
	if (!/\.(mjs|js|ts)$/u.test(base)) return false;
	return !base.includes(".test.") && !base.startsWith("test-");
}

/** Every production script under `scripts/`, repo-relative and sorted, so two runs on one tree
 *  produce the same list and a diff of the report is readable. */
export function productionScripts(root = REPO_ROOT) {
	const found = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules") continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (isProductionScript(full)) found.push(path.relative(root, full));
		}
	};
	walk(path.join(root, "scripts"));
	return found.sort();
}

/**
 * PURE. Which scripts the lane would run a suite for, and which it would not.
 *
 * Three states rather than a percentage: `covered` is a fact, `uncovered` is a fact, and the
 * TOTAL is what makes a rising ceiling distinguishable from a growing surface. A ratchet that
 * reported only a ratio would go green for deleting tested files.
 */
export function judgeCoverage(packageJson, files) {
	const covered = [];
	const uncovered = [];
	for (const file of files) {
		if (suitesForChangedPaths(packageJson, [file]).length > 0) covered.push(file);
		else uncovered.push(file);
	}
	return { total: files.length, covered, uncovered };
}

function main() {
	const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
	const verdict = judgeCoverage(packageJson, productionScripts());
	const delta = verdict.uncovered.length - BASELINE_MAX_UNCOVERED;

	if (process.argv.includes("--json")) {
		process.stdout.write(
			`${JSON.stringify(
				{
					total: verdict.total,
					covered: verdict.covered.length,
					uncovered: verdict.uncovered.length,
					ceiling: BASELINE_MAX_UNCOVERED,
					delta,
					ok: delta <= 0,
					...(process.argv.includes("--list") ? { uncoveredFiles: verdict.uncovered } : {}),
				},
				null,
				2,
			)}\n`,
		);
		if (delta > 0) process.exitCode = 1;
		return;
	}

	process.stdout.write(
		`script test coverage: ${verdict.total} production file(s) under scripts/\n` +
			`  covered:   ${verdict.covered.length} (a change to one wakes a suite)\n` +
			`  uncovered: ${verdict.uncovered.length} / ceiling ${BASELINE_MAX_UNCOVERED} · delta ${delta >= 0 ? "+" : ""}${delta}\n`,
	);

	if (process.argv.includes("--list")) {
		process.stdout.write(`\n${verdict.uncovered.map((file) => `  ${file}`).join("\n")}\n`);
	}

	if (delta > 0) {
		process.stdout.write(
			`\nOVER THE CEILING — ${delta} more file(s) under scripts/ than recorded have no suite the\n` +
				"lane would run for them. Write one, or say in the commit why this file is not the kind\n" +
				"of thing that has one. Raising the ceiling to admit it makes this gate a formality.\n" +
				"  `node scripts/script-test-coverage.mjs --list` names them.\n",
		);
		process.exitCode = 1;
	} else if (delta < 0) {
		process.stdout.write(
			`\nBELOW THE CEILING by ${-delta} — take BASELINE_MAX_UNCOVERED down to ${verdict.uncovered.length}.\n` +
				"A ceiling left above the real number is a ceiling that permits a silent regression.\n",
		);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main();
