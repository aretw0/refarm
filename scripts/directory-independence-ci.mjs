#!/usr/bin/env node
/**
 * The directory-independence probe, run against a SEEDED NODE — the CI-runnable half (ISS-097).
 *
 * ## Why this could not exist until now
 *
 * The probe's verdict is only as strong as the node it was taken on, and on a machine with no
 * node every answer is empty. Measured 2026-08-10: `workspace list` returned `[]` from every
 * directory and scored `same`; so did `connection status`. **Two absences agreeing is not
 * independence — it is a step that measured nothing**, which is precisely the defect this
 * instrument exists to find. Wiring that into CI would have manufactured the defect inside the
 * instrument, so the decision was to keep the probe local and file the condition that would
 * change it: a seeded node.
 *
 * `seedNodeFixture` is that condition. Measured 2026-08-11 against it:
 *
 * ```
 * 45 node-scoped commands · 3 directories (two declared workspaces + one outside)
 *   43 populated      <- the half an empty home could never have
 *   39 same
 *    4 differs-as-declared
 *    0 convicted
 *    2 empty          <- auth list, extension list: REPORTED, never counted as agreement
 * ```
 *
 * ## The two ratchets, and why the second one is the point
 *
 * 1. **CONVICTIONS must stay 0.** The ordinary guard: a node-scoped command that answers
 *    differently from different directories, without a declared reason, fails here.
 *
 * 2. **POPULATED must not fall.** This is the guard on the guard. Every conviction this
 *    instrument can find depends on there being something to compare, and the failure mode is
 *    silent: a change that makes an answer empty turns a real comparison into two absences
 *    agreeing, and the run goes GREENER, not redder. A ceiling on convictions alone would
 *    reward exactly the regression this whole item is about.
 *
 * ## Cost, measured
 *
 * ~71s on the machine this was written on: 45 commands x (3 directories + 1 control) spawns of
 * the built CLI. That is a gate of its own, not something to hang on every push.
 *
 * ## Where this WOULD belong in CI
 *
 * Not wired here. `.github/workflows/**` is a CLAUDE.md section 8 protected surface, and the
 * precedent this repo already set (`docs/superpowers/plans/2026-08-07-who-owns-this-work.md`,
 * Step 6) is to say where it belongs rather than to add it:
 *
 * - **Release Health**, not Test & Quality. Test & Quality skips work by change detection, and
 *   this probe's whole subject is behaviour that no single changed file predicts — a resolver
 *   edited in `packages/config` convicts a command in `apps/refarm`. Release Health already runs
 *   complete for that reason.
 * - **After the CLI build step**, since it spawns `apps/refarm/dist/index.js`.
 * - **`pnpm run probe:seeded`**, which is what this file is wired to.
 */
import process from "node:process";

import {
	PROBE_COMMANDS,
	formatProbeTable,
	judge,
	runProbeAgainstSeededNode,
	seedNodeFixture,
} from "./directory-independence.mjs";

/** Convictions. Zero, and it stays zero — a node-scoped command that varies without a declared
 *  reason is the defect this instrument exists to name. */
export const SEEDED_MAX_CONVICTIONS = 0;

/**
 * The floor on how many rows had anything to compare, recorded 2026-08-11 as this run's own
 * count. Two rows are legitimately empty against this fixture (`auth list`, `extension list`):
 * seeding them needs credentials and an installed extension, which is a bigger fixture and its
 * own decision. They are REPORTED as `empty` rather than folded into `same`.
 *
 * Raise this when the fixture grows. Never lower it to make a run pass — a falling count is the
 * instrument going blind, which is the one failure it cannot report about itself.
 */
export const SEEDED_MIN_POPULATED = 43;

function main() {
	const fixture = seedNodeFixture();
	try {
		const commands = PROBE_COMMANDS.filter((command) => command.scope === "node");
		const rows = runProbeAgainstSeededNode(commands, fixture);

		const convicted = rows.filter((row) => judge(row.verdict, row.scope) === "convicted");
		const populated = rows.filter((row) => row.populated);
		const empty = rows.filter((row) => !row.populated);

		if (process.argv.includes("--table")) process.stdout.write(`${formatProbeTable(rows)}\n\n`);

		process.stdout.write(
			`directory-independence (seeded node): ${rows.length} node-scoped command(s) ` +
				`across ${Object.keys(fixture.directories).length} directories\n` +
				`  populated:  ${populated.length} / floor ${SEEDED_MIN_POPULATED}\n` +
				`  convicted:  ${convicted.length} / ceiling ${SEEDED_MAX_CONVICTIONS}\n` +
				`  empty:      ${empty.length}${empty.length > 0 ? ` (${empty.map((r) => r.name).join(", ")})` : ""}\n`,
		);

		let failed = false;
		if (convicted.length > SEEDED_MAX_CONVICTIONS) {
			failed = true;
			process.stdout.write(
				`\nCONVICTED — a node-scoped answer moved with the directory and nothing declared it:\n${convicted
					.map((row) => `  ${row.name}: ${(row.fieldPaths ?? []).join(", ")}`)
					.join("\n")}\n`,
			);
		}
		if (populated.length < SEEDED_MIN_POPULATED) {
			failed = true;
			process.stdout.write(
				`\nWENT BLIND — ${SEEDED_MIN_POPULATED - populated.length} row(s) that used to have ` +
					"something to compare now answer with nothing, so their agreement means nothing " +
					"either. Empty now: " +
					`${empty.map((row) => row.name).join(", ")}\n`,
			);
		}
		if (failed) process.exitCode = 1;
	} finally {
		fixture.cleanup();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main();
