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
 * THE REMAINING FIVE. Fifteen when this runner shipped, measured 2026-08-11;
 * ten closed the same day and each already failing before this runner existed. Named
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
 * REMOVE a name when its suite goes green. Never add one to make a run pass — that is the
 * mechanism this file exists to give the cadence, and adding to it is spending it.
 */
export const KNOWN_FAILING = [
	"audience:boundary:test",
	"devcontainer:contract:test",
	"extension-sandbox:poc:test",
	"release:brand:guard",
	"release:readiness:test",
];

/** PURE. Every package.json script that invokes `node --test`, in declaration order. Reading the
 *  registry rather than globbing the filesystem is what carries the prerequisites — see this
 *  file's header for the five suites that fail when the build in front of them is skipped. */
export function nodeTestScripts(packageJson) {
	return Object.entries(packageJson.scripts ?? {})
		.filter(([, command]) => command.includes("node --test"))
		.map(([name]) => name);
}

/** PURE. What the run means, given what failed and what was already known to fail. Three states:
 *  a NEW failure is the finding, a known one is the backlog, and a known one that PASSED is the
 *  backlog shrinking and should be recorded rather than silently enjoyed. */
export function classify(results, knownFailing = KNOWN_FAILING) {
	const known = new Set(knownFailing);
	const failed = results.filter((result) => !result.ok).map((result) => result.name);
	return {
		newFailures: failed.filter((name) => !known.has(name)).sort(),
		knownFailures: failed.filter((name) => known.has(name)).sort(),
		recovered: knownFailing.filter((name) => !failed.includes(name)).sort(),
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
	const only = process.argv.includes("--only-known")
		? KNOWN_FAILING
		: nodeTestScripts(packageJson);
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
			`  known failures: ${verdict.knownFailures.length} / ${KNOWN_FAILING.length} recorded\n`,
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
