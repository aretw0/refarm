#!/usr/bin/env node
/**
 * Runs every `node --test` suite this repo registers — the ones no lane has ever reached.
 *
 * ## Why this exists
 *
 * `package.json` registers ~87 `node --test` entries. `refarm agent finish` runs vitest through
 * turbo, which does not see any of them, so the entire `scripts/` test surface has been
 * invisible to the agent cadence.
 *
 * That is not theoretical. `scripts/no-os-resolution.test.mjs` sat RED for hours on 2026-08-11
 * while after-edit, after-commit and a full 282-task `turbo run test` all reported green — the
 * commit that split `declared-base.js` out of config's barrel added a third module to an
 * allowlist the test pins BY VALUE, and nothing ran the test. It surfaced only when a later
 * slice happened to run it by hand.
 *
 * ## It runs the REGISTERED SCRIPT, never the raw file
 *
 * This matters and was measured. Running `node --test <file>` over every
 * `scripts/**‍/*.test.mjs` reports 14 failures — but five of those are suites whose package.json
 * entry builds a dependency first (`pnpm -C packages/local-surface run build && node --test …`).
 * Invoking the file bare skips the build and the suite fails for a reason that has nothing to do
 * with the code. The registration is where the prerequisites live, so the registration is what
 * gets invoked.
 *
 * ## The ceiling, and why it is not zero
 *
 * Measured 2026-08-11 by running all of them THROUGH THEIR REGISTERED SCRIPTS: **fifteen suites
 * fail**, and they were already failing — invisible, not new.
 *
 * The first count was seven, and it was wrong twice over: the run behind it invoked raw files
 * for some suites (skipping the builds in front of them) and simply omitted one. Eight more
 * appeared the moment this runner ran the registry properly, INCLUDING the five with build
 * prerequisites — they fail with their builds, not because of them. A number taken from a
 * partial run is the thing this runner exists to stop, and it produced one on the way in.
 *
 * Shipping at ceiling 0 would make this red on arrival, and a gate that is red on arrival is a
 * gate an operator learns to bypass. So it ships at the measured number with delta 0 — the same
 * shape every other ratchet in this repo has — and it can only go down.
 *
 * They are listed in `KNOWN_FAILING` so a NEW failure is distinguishable from an old one.
 * A suite that starts failing and is not on that list fails this runner immediately, which is
 * the property the cadence has been missing entirely.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * EMPTY, and it is meant to stay empty. Fifteen when this runner shipped on 2026-08-11; all
 * fifteen closed the same day — the last of them by finishing ADR-087 phase 3 rather than by
 * silencing it (ISS-114) and each already failing before this runner existed. Named
 * rather than counted, so the list is a work queue and a new failure cannot hide inside a
 * number.
 *
 * The ten that closed were four kinds, and only one was a test simply being wrong:
 *   - a hardcoded package count the repo grew past, beside the config the test already read;
 *   - five schema names left branded when ADR-087 debranded the packages;
 *   - two guards reporting REAL drift (a parser reading a function the table had moved out of;
 *     a container check with no way to declare, so its own gate was unreachable off-container);
 *   - one profile member with no consumer proof, which stayed red as a FILED finding (ISS-113)
 *     rather than being tagged green — stamping "consumer-proven" to pass a test is
 *     manufacturing the evidence the gate exists to demand.
 *
 * EVERY ENTRY CARRIES ITS REASON, which is what stops this from becoming a place to hide things.
 * A name with no reason is a silence; a name with a reason is a decision somebody can disagree
 * with. Fourteen of the original fifteen are gone because they were fixed; the one that remains
 * says why in its own value.
 *
 * The other honest path, taken by `requirements:supply:handoff:test`, is to make the SUITE assert
 * the blocked state and name its blocker (ISS-113) — a red thing turned into a green assertion
 * ABOUT the red thing. Prefer that where the failure is a fact about the repo rather than a
 * backlog of edits.
 */
export const KNOWN_FAILING = {};

/** PURE. Every package.json script that invokes `node --test`, in declaration order. Reading the
 *  registry rather than globbing the filesystem is what carries the prerequisites — see this
 *  file's header for the five suites that fail when the build in front of them is skipped. */
export function nodeTestScripts(packageJson) {
	return Object.entries(packageJson.scripts ?? {})
		.filter(([, command]) => command.includes("node --test"))
		.map(([name]) => name);
}

/**
 * PURE. Which registered suites are worth running for a set of changed files.
 *
 * ## Why this exists
 *
 * The whole registry takes ~125s, which is a `before-push` cost and not an `after-edit` one. So
 * the lane ran it only before pushing — and `workspace-script:test` sat RED for a whole day on
 * 2026-08-12 because of an edge added that morning, with every after-edit green the entire time.
 * That is the same failure this runner was built for, one level up: a suite nobody runs is a
 * suite that is not a test.
 *
 * ## Matched by NAME, and the convention is the contract
 *
 * A suite for `scripts/foo.mjs` is `scripts/foo.test.mjs` or `scripts/ci/test-foo-lib.mjs`, and a
 * registered command names the file it runs. So a changed file's stem, found inside a registered
 * `node --test` command, is the link. Heuristic, and deliberately so: the alternative is a
 * hand-maintained map, which is a second registry to feed and the exact thing that goes stale.
 *
 * AN EMPTY RESULT IS NOT AN ALL-CLEAR — it is "no suite names this file", which is the untested
 * 60% ISS-106 is about. The caller reports the distinction rather than printing a green tick.
 */
/**
 * SUITES THAT ARE ABOUT THE REPOSITORY, not about one file.
 *
 * Name-matching finds the suite FOR a changed script. It cannot find a suite about an invariant
 * the change happens to break, and that gap is not hypothetical — it is exactly what happened on
 * 2026-08-12. A dependency edge added to `packages/sidecar-client/package.json` invalidated the
 * build order pinned in `scripts/ci/subprocess-utils.mjs`; `workspace-script:test` went red and
 * stayed red for a day, with every after-edit green, because nothing connected a manifest edit to
 * an ordering check.
 *
 * Each entry is a predicate over a changed path and the suites it should wake. Small on purpose:
 * a list that tried to be complete would be a second dependency graph, maintained by hand.
 */
const REPO_INVARIANT_SUITES = [
	{
		// A manifest edit can change the dependency graph, and the build order is a hand-kept
		// projection of that graph. This is the pair that has already drifted once.
		matches: (file) => file.endsWith("/package.json") || file === "package.json",
		suites: ["workspace-script:test"],
	},
];

export function suitesForChangedPaths(packageJson, paths) {
	const scripts = packageJson.scripts ?? {};
	const matched = new Set();
	for (const file of paths) {
		for (const rule of REPO_INVARIANT_SUITES) {
			if (!rule.matches(file)) continue;
			for (const suite of rule.suites) {
				if (scripts[suite]) matched.add(suite);
			}
		}
	}
	for (const file of paths) {
		const stem = (file.split("/").pop() ?? "")
			.replace(/\.test\.mjs$/u, "")
			.replace(/^test-/u, "")
			.replace(/-lib$/u, "")
			.replace(/\.(mjs|js|ts)$/u, "");
		if (stem.length < 3) continue;
		for (const [name, command] of Object.entries(scripts)) {
			if (!command.includes("node --test")) continue;
			if (command.includes(`/${stem}.`) || command.includes(`test-${stem}`) || command.includes(`${stem}.test.`)) {
				matched.add(name);
			}
		}
	}
	return [...matched].sort();
}

/** PURE. What the run means, given what failed and what was already known to fail. Three states:
 *  a NEW failure is the finding, a known one is the backlog, and a known one that PASSED is the
 *  backlog shrinking and should be recorded rather than silently enjoyed. */
export function classify(results, knownFailing = KNOWN_FAILING) {
	const names = Array.isArray(knownFailing) ? knownFailing : Object.keys(knownFailing);
	const known = new Set(names);
	const failed = results.filter((result) => !result.ok).map((result) => result.name);
	return {
		newFailures: failed.filter((name) => !known.has(name)).sort(),
		knownFailures: failed.filter((name) => known.has(name)).sort(),
		recovered: names.filter((name) => !failed.includes(name)).sort(),
		passed: results.filter((result) => result.ok).length,
		total: results.length,
	};
}

function runScript(name, timeoutMs) {
	const started = Date.now();
	const result = spawnSync("pnpm", ["run", name], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		timeout: timeoutMs,
	});
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	const pass = Number(/^# pass (\d+)/m.exec(output)?.[1] ?? 0);
	const fail = Number(/^# fail (\d+)/m.exec(output)?.[1] ?? 0);
	// Timeout and spawn failure are their own state: reporting them as "0 assertions passed"
	// would let an environment problem read as a code failure.
	const timedOut = result.signal !== null && result.signal !== undefined;
	return {
		name,
		ok: !timedOut && result.status === 0 && fail === 0,
		pass,
		fail,
		timedOut,
		elapsedMs: Date.now() - started,
	};
}

function main() {
	const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
	// `--for <path>…` runs only the suites that NAME the changed files — the after-edit shape.
	// Everything else runs the whole registry, which is the before-push shape.
	const forIndex = process.argv.indexOf("--for");
	const changed = forIndex === -1 ? [] : process.argv.slice(forIndex + 1).filter((a) => !a.startsWith("--"));
	const only = process.argv.includes("--only-known")
		? Object.keys(KNOWN_FAILING)
		: forIndex === -1
			? nodeTestScripts(packageJson)
			: suitesForChangedPaths(packageJson, changed);

	if (forIndex !== -1 && only.length === 0) {
		// NOT AN ALL-CLEAR. No registered suite names these files, which is the untested majority
		// ISS-106 measures — said plainly rather than printed as a green tick.
		process.stdout.write(
			`script tests: no registered suite names ${changed.length} changed file(s) — ` +
				"nothing was verified here, which is not the same as nothing being wrong.\n",
		);
		return;
	}
	const timeoutMs = 180_000;

	const results = [];
	for (const name of only) {
		const result = runScript(name, timeoutMs);
		results.push(result);
		if (!result.ok) {
			process.stdout.write(
				`  FAIL  ${name}${result.timedOut ? " (timed out)" : ` (${result.fail} assertion(s))`}\n`,
			);
		}
	}

	const verdict = classify(results);
	const assertions = results.reduce((total, result) => total + result.pass, 0);
	const seconds = (results.reduce((total, result) => total + result.elapsedMs, 0) / 1000).toFixed(0);

	process.stdout.write(
		`\nscript tests: ${verdict.passed}/${verdict.total} suites green, ` +
			`${assertions} assertion(s), ${seconds}s\n` +
			`  new failures:   ${verdict.newFailures.length} / ceiling 0\n` +
			`  known failures: ${verdict.knownFailures.length} / ${Object.keys(KNOWN_FAILING).length} recorded\n`,
	);

	if (verdict.recovered.length > 0) {
		process.stdout.write(
			`\nRECOVERED — these are on KNOWN_FAILING and passed. Remove them from the list:\n` +
				`${verdict.recovered.map((name) => `  ${name}`).join("\n")}\n`,
		);
	}
	if (verdict.newFailures.length > 0) {
		process.stdout.write(
			`\nNEW FAILURE — a suite that was green is not any more, and no lane would have told you:\n` +
				`${verdict.newFailures.map((name) => `  ${name}`).join("\n")}\n`,
		);
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main();
