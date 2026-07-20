#!/usr/bin/env node
/**
 * `pnpm run verify` — reproduce the pre-push gate FAITHFULLY, on demand, without the hook's short
 * timeouts. The pre-push type-check is scoped + time-boxed; a core-package change fans out to ~50
 * dependents and can exceed that box on GREEN code (a false STRICT block). This runs the SAME turbo
 * tasks (type-check → lint → test) over the changed packages AND their dependents, with the concurrency
 * each task can afford (type-check is tsc-light → parallel; lint/test may compile Rust → conservative),
 * and NO artificial timeout. If it's green, the code is genuinely green — safe to push (use
 * `git push --no-verify` only if the hook itself times out; the gate has already passed here).
 *
 * Usage:
 *   pnpm run verify                       # changed-since-base packages + their dependents
 *   pnpm run verify @refarm.dev/capabilities @refarm.dev/tractor
 *   pnpm run verify --base main           # diff against a different base ref
 *   pnpm run verify --no-tests            # type-check + lint only (skip the heavier test task)
 *
 * The filter-building core (buildVerifyPlan) is pure + exported so it is unit-tested
 * (verify-changed.test.mjs) without spawning turbo.
 */
import { spawnSync } from "node:child_process";

/** Task phases in gate order, each with the concurrency it can safely afford on an ~8GB host.
 * type-check is tsc-only (memory-light) → parallel; lint/test may compile Rust → conservative. */
const PHASES = [
	{ task: "type-check", concurrency: 4, heavy: false },
	{ task: "lint", concurrency: 2, heavy: true },
	{ task: "test", concurrency: 2, heavy: true },
];

/**
 * Build the turbo run plan from CLI args. PURE — no git, no spawn.
 * - explicit package names → each becomes a `<pkg>...` filter (the package + its dependents).
 * - none → a single `[<base>]...` filter (packages changed since base + their dependents).
 * `--base <ref>` sets the diff base (default origin/develop); `--no-tests` drops the test phase.
 */
export function buildVerifyPlan(argv, { defaultBase = "origin/develop" } = {}) {
	const packages = [];
	let base = defaultBase;
	let runTests = true;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--base") {
			base = argv[++i];
		} else if (arg === "--no-tests") {
			runTests = false;
		} else if (arg.startsWith("--")) {
			// Unknown flag — ignore rather than fail (forward-compatible with turbo passthrough).
			continue;
		} else {
			packages.push(arg);
		}
	}
	const filters = packages.length > 0 ? packages.map((pkg) => `${pkg}...`) : [`[${base}]...`];
	const phases = PHASES.filter((phase) => runTests || phase.task !== "test");
	return { filters, phases, base, packages };
}

/** Turn one phase + the filters into the turbo argv (no timeout, errors-only logs). */
export function turboArgsFor(phase, filters) {
	return [
		"turbo",
		"run",
		phase.task,
		...filters.map((f) => `--filter=${f}`),
		`--concurrency=${phase.concurrency}`,
		"--output-logs=errors-only",
		"--continue",
	];
}

function main() {
	const plan = buildVerifyPlan(process.argv.slice(2));
	const scope = plan.packages.length > 0 ? plan.packages.join(", ") : `changed since ${plan.base} (+ dependents)`;
	process.stdout.write(`🔍 verify — faithful gate over: ${scope}\n\n`);

	const failed = [];
	for (const phase of plan.phases) {
		process.stdout.write(`▶ ${phase.task} (concurrency=${phase.concurrency})\n`);
		const args = turboArgsFor(phase, plan.filters);
		const result = spawnSync("pnpm", ["exec", ...args], {
			stdio: "inherit",
			env: { ...process.env, CI: "1" },
		});
		if (result.status !== 0) {
			failed.push(phase.task);
			process.stdout.write(`   ❌ ${phase.task} failed\n\n`);
		} else {
			process.stdout.write(`   ✅ ${phase.task} passed\n\n`);
		}
	}

	if (failed.length > 0) {
		process.stdout.write(`❌ verify failed: ${failed.join(", ")}. Fix the root cause above, then re-run.\n`);
		process.exitCode = 1;
		return;
	}
	process.stdout.write(
		"✅ verify green — the changed packages + dependents type-check, lint, and test.\n" +
			"   The code is genuinely green: safe to push (use `git push --no-verify` only if the\n" +
			"   pre-push hook itself times out — this gate has already passed).\n",
	);
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
