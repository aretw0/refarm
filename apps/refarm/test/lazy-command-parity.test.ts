import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { initCommand } from "../src/commands/init.js";
import { migrateCommand } from "../src/commands/migrate.js";
import { sowCommand } from "../src/commands/sow.js";

/**
 * A LAZY WRAPPER THAT FORGETS AN OPTION MAKES IT UNTYPEABLE.
 *
 * `program.ts` defers `import()` for the slowest commands, which means their options must be
 * RE-DECLARED by hand at the top level — the real command is not loaded when the CLI is built.
 * That is a second declaration of the same contract, and on 2026-08-12 two of the three had
 * drifted:
 *
 *   refarm init --json         → error: unknown option '--json'
 *   refarm init --template x   → error: unknown option '--template'
 *   refarm sow --reconfigure   → error: unknown option '--reconfigure'
 *
 * The last one is the worst kind, because `refarm sow --help` ADVERTISED it: "--reconfigure always
 * asks for model credentials (API key or OAuth login)". The help told the operator to use a flag
 * the CLI rejects, and the tests passed the whole time — they drove `sowCommand` directly, which
 * has the option, rather than the program the operator types into.
 *
 * These compare the two declarations. Parity is the assertion; the flag list itself is not pinned,
 * so adding an option to a command needs no edit here — only remembering to expose it.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLI = path.join(REPO_ROOT, "apps", "refarm", "dist", "index.js");

/** The options the operator can actually type, read from the built CLI's own help. */
function cliOptions(command: string): string[] {
	const help = execFileSync(process.execPath, [CLI, command, "--help"], { encoding: "utf8" });
	// ONLY the Options: block. Flags mentioned in the prose below it are documentation, not
	// registrations — reading those was what made the first measurement of this defect wrong.
	const block = help.split(/^Options:$/mu)[1]?.split(/\n\s*\n/u)[0] ?? "";
	const flags = [...block.matchAll(/^\s+(?:-\w, )?(--[a-z][a-z0-9-]*)/gmu)]
		.map((match) => match[1])
		.filter((flag): flag is string => Boolean(flag));
	return [...new Set(flags)].sort();
}

const LAZY_COMMANDS = [
	{ name: "init", command: initCommand },
	{ name: "sow", command: sowCommand },
	{ name: "migrate", command: migrateCommand },
];

describe("lazy command option parity", () => {
	it.each(LAZY_COMMANDS)("$name exposes every option its real command accepts", ({ name, command }) => {
		const real = command.options.map((option) => option.long).filter((long): long is string => Boolean(long));
		const exposed = cliOptions(name);
		const unreachable = real.filter((flag) => !exposed.includes(flag));
		expect(
			unreachable,
			`refarm ${name} rejects ${unreachable.join(", ")} — the real command accepts them, so the ` +
				"lazy declaration in program.ts is missing them (options list AND toArgs).",
		).toEqual([]);
	});

	it("the CLI actually accepts the flags this found missing, not just lists them", () => {
		// Listing an option and forwarding it are separate edits in `createLazyCommand`, and a flag
		// present in the help but absent from `toArgs` would parse and then vanish. `--help` on the
		// sub-invocation proves the flag survives parsing; the forwarding is covered by the fact
		// that a missing `toArgs` entry silently drops it, which the option tests below would not
		// catch on their own.
		for (const invocation of [
			["init", "--json"],
			["init", "--template", "node"],
			["sow", "--reconfigure"],
		]) {
			expect(() =>
				execFileSync(process.execPath, [CLI, ...invocation, "--help"], { stdio: "pipe" }),
			).not.toThrow();
		}
	});

	it("every flag the help TEXT advertises is a flag the CLI registers", () => {
		// The defect that made this worst: `sow --help` promised `--reconfigure` while the CLI
		// rejected it. Prose that names a flag is a promise to the operator.
		for (const { name } of LAZY_COMMANDS) {
			const help = execFileSync(process.execPath, [CLI, name, "--help"], { encoding: "utf8" });
			const afterOptions = help.split(/^Options:$/mu)[1]?.split(/\n\s*\n/u).slice(1).join("\n") ?? "";
			const advertised = [
				...new Set(
					[...afterOptions.matchAll(/(?:^|\s)(--[a-z][a-z0-9-]{2,})/gmu)]
						.map((match) => match[1])
						.filter((flag): flag is string => Boolean(flag)),
				),
			];
			const registered = cliOptions(name);
			const promised = advertised.filter((flag) => !registered.includes(flag));
			expect(promised, `refarm ${name} --help names ${promised.join(", ")} but the CLI does not register it`).toEqual([]);
		}
	});
});
