/**
 * The coverage of `scripts/directory-independence.mjs` stops rotting here.
 *
 * The probe reached 5-of-64 top-level commands with nobody choosing that — nothing ever required
 * otherwise, so nothing ever noticed. This test walks the CLI's own Commander tree and requires
 * every leaf command to be accounted for: probed, excluded by a DERIVED rule that re-evaluates on
 * every run, or excluded by a DECLARED entry naming a category with a written reason.
 *
 * The three kinds are kept apart deliberately. A derived exclusion cannot go stale — the day a
 * command gains `--json` or loses its required argument, it falls out of the derived set and this
 * test demands a decision about it. A declared exclusion is a choice someone made and signed. And
 * `not-yet-probed` is neither: it is the honest backlog of read-only commands that SHOULD be probed,
 * ratcheted so it can only shrink.
 */
import { describe, expect, it } from "vitest";

import {
	EXCLUSION_CATEGORIES,
	NOT_YET_PROBED_CEILING,
	PROBE_EXCLUSIONS,
} from "../../../../scripts/directory-independence-exclusions.mjs";
import { PROBE_COMMANDS } from "../../../../scripts/directory-independence.mjs";
import { program } from "../../src/program.js";

interface Leaf {
	name: string;
	hasJson: boolean;
	requiresArgument: boolean;
}

/** Every LEAF command, as `"budget by-host"`. A command with subcommands is a namespace, not a
 *  thing that answers: `budget` alone prints help, `budget by-host` returns a value. Commander's
 *  auto-generated `help` subcommand is not a leaf of the CLI's surface. */
function leafCommands(command: any, prefix: string[] = []): Leaf[] {
	const children = (command.commands ?? []).filter((child: any) => child.name() !== "help");
	if (children.length === 0) {
		return prefix.length > 0
			? [
					{
						name: prefix.join(" "),
						hasJson: (command.options ?? []).some((option: any) => option.long === "--json"),
						requiresArgument: (command.registeredArguments ?? []).some((argument: any) => argument.required),
					},
				]
			: [];
	}
	return children.flatMap((child: any) => leafCommands(child, [...prefix, child.name()]));
}

/** The leading non-flag tokens of a probe entry's argv: `["budget","observations","--limit","3"]`
 *  is the command `budget observations`. Stopping at the first flag matters — `--limit 3` carries a
 *  VALUE that is not a flag and would otherwise be read as a subcommand name. */
function probedName(argv: string[]): string {
	const tokens: string[] = [];
	for (const token of argv) {
		if (token.startsWith("-")) break;
		tokens.push(token);
	}
	return tokens.join(" ");
}

describe("directory-independence probe coverage", () => {
	const leaves = leafCommands(program);
	const probed = new Set(PROBE_COMMANDS.map((command: any) => probedName(command.argv)));
	const declared = new Map(PROBE_EXCLUSIONS.map((entry: any) => [entry.argv.join(" "), entry.category]));

	it("finds the CLI's leaf commands at all", () => {
		// A tree-walk that silently found nothing would make every assertion below vacuously true —
		// the shape of failure this whole slice exists to stop.
		expect(leaves.length).toBeGreaterThan(150);
	});

	it("accounts for every leaf command: probed, derived-excluded, or declared with a reason", () => {
		const unaccounted = leaves
			.filter((leaf) => leaf.hasJson && !leaf.requiresArgument)
			.map((leaf) => leaf.name)
			.filter((name) => !probed.has(name) && !declared.has(name));
		expect(unaccounted).toEqual([]);
	});

	it("every declared exclusion names a category that carries a written reason", () => {
		for (const [name, category] of declared) {
			// Two assertions, not one: an unknown category and a category whose reason is a stub are
			// different failures, and a reader of the output should be told which one happened.
			const reason = (EXCLUSION_CATEGORIES as Record<string, string | undefined>)[category as string];
			expect(reason, `${name} names unknown category "${category}"`).toBeDefined();
			expect(reason?.trim().length ?? 0, `category "${category}" has no written reason`).toBeGreaterThan(40);
		}
	});

	it("declares no exclusion a derived rule already covers", () => {
		// A hand-written entry for a command the derived rules exclude anyway is dead weight that
		// outlives its reason: the day the command gains a probeable shape, the stale entry keeps it
		// silently out.
		const derived = new Set(
			leaves.filter((leaf) => !leaf.hasJson || leaf.requiresArgument).map((leaf) => leaf.name),
		);
		const redundant = [...declared.keys()].filter((name) => derived.has(name));
		expect(redundant).toEqual([]);
	});

	it("keeps the not-yet-probed backlog under its ratchet", () => {
		const backlog = [...declared.entries()].filter(([, category]) => category === "not-yet-probed");
		expect(backlog.length).toBeLessThanOrEqual(NOT_YET_PROBED_CEILING);
	});

	it("never lets a probed command also be excluded", () => {
		const both = [...declared.keys()].filter((name) => probed.has(name));
		expect(both).toEqual([]);
	});
});
