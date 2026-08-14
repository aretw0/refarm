#!/usr/bin/env node
/**
 * `directory-independence` — the probe. Answers a different question than
 * `scripts/no-os-resolution.mjs` (the ratchet): the ratchet counts sites by CODE SHAPE
 * (`?? process.cwd()`, `= homedir()`). Shape is right for stopping NEW defects, but it is not
 * a map of what hurts — a prior slice of the plan this file implements selected ten of the
 * ratchet's sites by filename and an audit proved eight were correct code, while the live
 * defect (`refarm connection status --json` losing the operator's VPN once invoked from
 * outside the repo) lived in a file not on that list at all.
 *
 * This probe measures by CONSEQUENCE instead: it runs each read-only `--json` command from
 * several real directories and diffs the parsed answers. A command whose answer must not
 * depend on where the operator stands declares that (`allowedVaryingFieldPaths: []`); one that
 * legitimately varies — because part of its answer is genuinely a fact about the working tree,
 * like "which agent.wasm did THIS checkout build" — declares WHICH field paths may vary, and
 * everything else is still compared. A blanket "this command is exempt" would hide a real
 * defect inside a legitimate one, so declaration is per FIELD PATH, never per command.
 *
 * `compareAnswers(byDirectory, declaration)` (below) is PURE — it takes parsed answers keyed
 * by an arbitrary directory label plus the command's declaration and returns one of four
 * verdicts. Four, not two: `same | differs-as-declared | differs-undeclared | unrunnable`. The
 * fourth is load-bearing — a command that crashes or times out in a directory produces no
 * output, and comparing two EMPTY results would read as agreement (`same`) rather than the
 * "I don't know" it actually is. See `directory-independence.test.mjs` for that trap pinned
 * directly as a test.
 *
 * Everything below the "impure edge" marker actually spawns the built CLI
 * (`apps/refarm/dist/index.js`) from each directory with a timeout, parses its stdout as JSON,
 * and composes that with `compareAnswers` for `runProbe`, which is what this file's own CLI
 * entry point (`node scripts/directory-independence.mjs`) and `package.json`'s
 * `directory-independence` script call.
 *
 * Usage: `node scripts/directory-independence.mjs` — prints one row per probed command with
 * its verdict, exits non-zero if anything is `differs-undeclared` or `unrunnable` (today,
 * `connection status` is exactly that — a live, known defect Task 2 of the same plan fixes,
 * not a bug in this probe).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const CLI_PATH = path.join(REPO_ROOT, "apps/refarm/dist/index.js");
const DEFAULT_TIMEOUT_MS = 15_000;

// ---- Answer entries: the two shapes `byDirectory[label]` can take. ----
//
// A directory's answer is either "the command ran and produced this parsed JSON value" or
// "the command did not produce a comparable answer here" — never a bare parsed value and
// never `null`, because `null` is itself a value a real `--json` answer could legitimately
// contain and overloading it would make "it failed" indistinguishable from "it answered null".

/** Wraps a successfully parsed JSON answer, with the exit code the command left behind.
 *
 * ISS-098: the exit code is part of the ANSWER, not a gate on whether there was one. `refarm health
 * --json` prints a complete envelope with ok:false and exits non-zero when a project has findings —
 * it ran, and recording that as "did not run" both loses the answer and convicts (or excuses) for
 * the wrong reason. Defaults to 0 so every existing caller and test keeps its meaning. */
export function ran(value, exitCode = 0) {
	return { status: "ran", value, exitCode };
}

/** Wraps a directory where the command produced NO COMPARABLE ANSWER: a crash, a timeout, a missing
 * binary, or stdout that is not JSON. A non-zero exit is NOT one of these (ISS-098) — a command that
 * printed a valid envelope and exited 1 answered, and its exit code is compared like any other
 * field. `reason` is free text for the report table, not matched on. */
export function unrunnable(reason) {
	return { status: "unrunnable", reason };
}

// ---- Pure field-path diffing. ----

const ABSENT = Symbol("directory-independence:absent");

/** PURE. Recursively collects every LEAF field path reachable from `value` into `into` (a
 * `Set<string>`), using `parent.child` for plain-object keys. Arrays are ATOMIC leaves —
 * `collections`/`otherSovereignDirs`/`divergences` are each ONE field path, never decomposed
 * by index. That is a deliberate choice, not a simplification for its own sake: this file's
 * first version indexed into arrays (`connections[0].name`), and a command whose array
 * differs in LENGTH between directories (`connections: []` vs `connections: [1 item]`, the
 * real shape of the `connection status` defect this probe was built to catch) then produced
 * BOTH a diverging `"connections"` path (the whole array differs) AND diverging
 * `"connections[0].name"` / `"connections[0].state"` paths (index 0 is absent on the empty
 * side) — three overlapping reports of the same one fact. Treating the array as one leaf
 * reports it once, and matches how every array in these five commands' answers is actually
 * DECLARED when it does legitimately vary (`context.otherSovereignDirs`,
 * `context.divergences` — named as whole fields in `PROBE_COMMANDS`, never index-qualified).
 * A non-empty plain object, or an empty object/array, or a non-object value
 * (`string`/`number`/`boolean`/`null`), is a leaf too. */
function collectLeafPaths(value, prefix, into) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		into.add(prefix);
		return;
	}
	const keys = Object.keys(value);
	if (keys.length === 0) {
		into.add(prefix);
		return;
	}
	for (const key of keys) {
		collectLeafPaths(value[key], prefix ? `${prefix}.${key}` : key, into);
	}
}

/** PURE. Reads dot-separated `fieldPath` (`"context.node.pid"`) out of `value`, returning the
 * `ABSENT` sentinel (never `undefined` — a real answer could contain an explicit
 * `undefined`-shaped gap) when the path does not resolve in this particular directory's answer
 * at all. Never descends into an array — arrays are leaves (see `collectLeafPaths`), so a
 * `fieldPath` never contains an index token to begin with. */
function getAtPath(value, fieldPath) {
	let cur = value;
	for (const key of fieldPath.split(".")) {
		if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !(key in cur)) return ABSENT;
		cur = cur[key];
	}
	return cur;
}

/** PURE. Leaf-value equality. Leaves reached by `collectLeafPaths` are primitives, `null`, an
 * empty `{}`, or ANY array (empty or not, arrays are always leaves) — `JSON.stringify` is a
 * safe, order-stable comparison for that shape (a real answer's arrays here are never
 * order-sensitive-but-differently-serialized; they are plain JSON already). */
function valuesEqual(a, b) {
	if (a === ABSENT || b === ABSENT) return a === b;
	return JSON.stringify(a) === JSON.stringify(b);
}

/** PURE. True when `fieldPath` is exactly one of `declaredPaths`, or is nested under one of
 * them via plain-object keys (`"context.node.pid"` is covered by a declared `"context.node"`).
 * Prefix match, not substring match — `"context.node"` must NOT cover an unrelated
 * `"context.nodeEnvironment"`. */
function isDeclaredPath(fieldPath, declaredPaths) {
	return declaredPaths.some((declared) => fieldPath === declared || fieldPath.startsWith(`${declared}.`));
}

/**
 * PURE. `byDirectory` is `{ [directoryLabel]: ran(value) | unrunnable(reason) }` — at least one
 * entry, arbitrary labels. `declaration` is `{ allowedVaryingFieldPaths: string[] }`; an empty
 * array means the command must answer identically from every directory.
 *
 * Returns `{ verdict, fieldPaths, unrunnableDirectories }`. The verdict says only what was
 * OBSERVED; what the observation MEANS is `judge(verdict, scope)`'s job, below.
 *   - `verdict` is exactly one of `"same" | "differs-as-declared" | "differs-undeclared" |
 *     "unrunnable-somewhere" | "unproven"`.
 *   - The unrunnable branches come FIRST — before any comparison — whenever any directory's entry
 *     is `unrunnable(...)`. A command that crashed in one directory produced no answer to compare;
 *     treating the directories that DID run as sufficient (and agreeing) would silently read a
 *     failure as agreement, which is exactly the trap this plan calls out by name.
 *   - Otherwise every leaf field path reachable from ANY directory's value is compared across
 *     ALL directories (a path present in one answer and absent in another counts as
 *     diverging). Paths where every directory agrees are dropped. What remains is split by
 *     `declaration.allowedVaryingFieldPaths`: if every diverging path is declared →
 *     `"differs-as-declared"` (fieldPaths = the declared paths that actually varied, for the
 *     report); if any diverging path is NOT declared → `"differs-undeclared"` (fieldPaths =
 *     ONLY the undeclared, i.e. offending, paths); no diverging paths at all → `"same"`.
 *   - `unrunnableDirectories` is `[]` except in the `"unrunnable"` verdict.
 */
/** PURE. The leaf field paths on which two or more answers disagree. Extracted so the SAME
 * comparison serves both questions this probe asks — "does it differ between directories?" and
 * "does it differ between two runs in one directory?" — because a control measured by a different
 * rule than the comparison it feeds would exclude the wrong fields. */
export const EXIT_CODE_PATH = "(exit code)";

export function divergingPaths(byDirectory) {
	const labels = Object.keys(byDirectory);
	// The exit code is compared as its own synthetic path, parenthesised so it can never collide
	// with a real JSON field name. Alongside the body, never instead of it: a command can answer the
	// same thing and exit differently, and both facts matter.
	const exitCodes = labels.map((label) => byDirectory[label].exitCode ?? 0);
	const exitDiverges = exitCodes.some((code) => code !== exitCodes[0]);
	const allPaths = new Set();
	for (const label of labels) collectLeafPaths(byDirectory[label].value, "", allPaths);
	const bodyPaths = [...allPaths]
		.filter((p) => p !== "")
		.filter((fieldPath) => {
			const values = labels.map((label) => getAtPath(byDirectory[label].value, fieldPath));
			return values.some((v) => !valuesEqual(v, values[0]));
		});
	return exitDiverges ? [EXIT_CODE_PATH, ...bodyPaths] : bodyPaths;
}

export function compareAnswers(byDirectory, declaration, inPlaceVaryingFieldPaths = []) {
	const labels = Object.keys(byDirectory);
	const unrunnableDirectories = labels.filter((label) => byDirectory[label].status === "unrunnable").sort();
	// THREE STATES where there were two. Failing in EVERY directory is the ENVIRONMENT — no daemon,
	// no sandbox node, a fixture argument this probe does not have — and it proves nothing about
	// directory independence. It must never be summed into `same`, which is precisely the defect
	// that let a 5-of-64 surface read as measured. Failing in SOME directories is the FINDING
	// itself: it is the shape of `ENOENT /tmp/.project/handoff.json`, a command that answers where
	// the operator happens to stand and refuses everywhere else.
	if (unrunnableDirectories.length === labels.length) {
		return { verdict: "unproven", fieldPaths: [], inPlaceFieldPaths: [], undeclaredInPlaceFieldPaths: [], unrunnableDirectories };
	}
	if (unrunnableDirectories.length > 0) {
		return { verdict: "unrunnable-somewhere", fieldPaths: [], inPlaceFieldPaths: [], undeclaredInPlaceFieldPaths: [], unrunnableDirectories };
	}

	const allDiverging = divergingPaths(byDirectory);

	// MEASURED, not declared. A field that also moves between two runs in ONE directory cannot be
	// attributed to the directory by this instrument at all — it is UNMEASURABLE here, which is a
	// third thing, neither "same" nor "convicted". Excluding it per FIELD (never per command) keeps
	// a real divergence sitting beside a clock from being swallowed with it. The exclusion is
	// self-expiring: if the field stops moving in place, the control stops reporting it and the
	// comparison picks it back up — unlike a hand-written declaration, which outlives its reason.
	const inPlace = allDiverging.filter((fieldPath) => isDeclaredPath(fieldPath, inPlaceVaryingFieldPaths)).sort();
	const measurable = allDiverging.filter((fieldPath) => !isDeclaredPath(fieldPath, inPlaceVaryingFieldPaths));

	const allowed = declaration.allowedVaryingFieldPaths ?? [];

	// THE CONTROL'S SILENCE IS NOT EVIDENCE (ISS-101). Seeing a field move in place PROVES it is
	// time-variant; NOT seeing it move proves nothing — the clock simply may not have ticked
	// between two spawns seconds apart. So the exclusion above is sound in one direction and the
	// verdict built on it flips: the same row scored `same` on one run and `differs-undeclared`
	// on the next, with no code change between them, and a verdict that flips is worse than one
	// that is wrong because nobody can tell which run to believe.
	//
	// More spawns cannot fix that — they buy asymptotic confidence at linear cost and the answer
	// stays probabilistic. A DECLARATION is the only deterministic mechanism this instrument has.
	//
	// So the control keeps its exclusion (it is self-expiring, which a hand-written declaration
	// is not) and loses its SILENCE: any field it caught moving that nobody declared is reported
	// here, because that field is a coin flip waiting to be tossed. The control's job becomes
	// growing the declarations rather than hiding behind them.
	const undeclaredInPlaceFieldPaths = inPlace.filter((fieldPath) => !isDeclaredPath(fieldPath, allowed));

	if (measurable.length === 0) {
		return {
			verdict: "same",
			fieldPaths: [],
			inPlaceFieldPaths: inPlace,
			undeclaredInPlaceFieldPaths,
			unrunnableDirectories: [],
		};
	}
	const undeclared = measurable.filter((fieldPath) => !isDeclaredPath(fieldPath, allowed));

	if (undeclared.length > 0) {
		return {
			verdict: "differs-undeclared",
			fieldPaths: undeclared.sort(),
			inPlaceFieldPaths: inPlace,
			undeclaredInPlaceFieldPaths,
			unrunnableDirectories: [],
		};
	}
	return {
		verdict: "differs-as-declared",
		fieldPaths: measurable.sort(),
		inPlaceFieldPaths: inPlace,
		unrunnableDirectories: [],
	};
}

/**
 * PURE. The verdict says what was OBSERVED; the scope says what that observation MEANS.
 *
 * Holding both in one field is what confined this probe to commands that must be identical, and so
 * to 5 of 64: a command that reads THIS project's documents diverges by design, and an instrument
 * whose only vocabulary was "differs" would have convicted it. Two scopes, and the `project` row for
 * `same` is an INVERSE check — a project-local command answering identically from `/tmp` has stopped
 * reading the project and is answering from the node, which no per-field comparison can see. Same
 * rule `refarm parity` applies to its `ISOLATING_AXES` table, where an axis that STOPPED diverging
 * reports UNHEALTHY rather than passing quietly.
 *
 * `unproven` is never a conviction under either scope: nothing was measured, and this function's
 * caller reports that as its own count rather than folding it into a pass.
 */
export function judge(verdict, scope) {
	if (verdict === "unproven") return "pass";
	if (scope === "project") return verdict === "same" ? "convicted" : "pass";
	return verdict === "differs-undeclared" || verdict === "unrunnable-somewhere" ? "convicted" : "pass";
}

/**
 * PURE. Every entry must declare its scope WITH a written reason, and every allowed varying field
 * path must name why it varies. Returns one message per problem; an empty array means well-formed.
 *
 * This exists because the exit criterion for the burn-down is "zero convictions", and that is
 * reachable two ways: by closing a divergence, or by declaring it. Without a required reason the
 * second is free and invisible, and the resulting green would be indistinguishable from a fixed
 * surface. A reason does not prevent a bad declaration — it makes one legible in review.
 */
export function validateDeclarations(commands) {
	const errors = [];
	for (const command of commands) {
		if (command.scope !== "node" && command.scope !== "project") {
			errors.push(`${command.name}: scope must be "node" or "project" — there is no default`);
		}
		if (!command.scopeReason || !String(command.scopeReason).trim()) {
			errors.push(`${command.name}: scope needs a written reason`);
		}
		for (const fieldPath of command.allowedVaryingFieldPaths ?? []) {
			if (!command.fieldReasons?.[fieldPath] || !String(command.fieldReasons[fieldPath]).trim()) {
				errors.push(`${command.name}: declared varying path ${fieldPath} has no reason`);
			}
		}
	}
	return errors;
}

/**
 * PURE. Four counts and a total, never one number. `declared` is NOT folded into `same`, and
 * `unproven` is folded into neither: zero convictions over five reasoned declarations and zero
 * convictions over forty are different states of the same surface, and so is zero convictions over
 * a surface half of which was never measured.
 */
export function summarise(rows) {
	return {
		probed: rows.length,
		same: rows.filter((row) => row.verdict === "same" && row.scope !== "project").length,
		declared: rows.filter((row) => row.verdict === "differs-as-declared").length,
		convicted: rows.filter((row) => judge(row.verdict, row.scope) === "convicted").length,
		unproven: rows.filter((row) => row.verdict === "unproven").length,
	};
}

/**
 * ISONOMY. The scope table below is a statement about REFARM — "`resume` speaks for the node" is
 * true on every machine that runs this binary. The verdict table it produces is a measurement of ONE
 * node on one date. Nothing in this file may confuse the two, and until 2026-08-10 one entry did: it
 * named `--workspace refarm` literally, so on any node that declares no workspace by that id the
 * entry measured nothing while still occupying a row.
 *
 * `SELF_WORKSPACE` is the placeholder for "whichever id this node declares for this checkout".
 * `withSelfWorkspace` substitutes it, and DROPS the entry when the node declares none — never
 * guesses an id, because a guessed workspace would produce a verdict about a workspace nobody named.
 */
export const SELF_WORKSPACE = "<self>";

/** The id this node declares for `repoRoot`, or `null` when this checkout is not a declared
 * workspace here. Mirror of `declaredSecondWorkspace`, and null for the same reason: a fallback
 * would put a verdict about some other workspace in this row. */
export function declaredSelfWorkspace(sovereignDir, repoRoot, { readFile = (p) => fs.readFileSync(p, "utf8") } = {}) {
	let config;
	try {
		config = JSON.parse(readFile(path.join(sovereignDir, "config.json")));
	} catch {
		return null;
	}
	for (const [id, value] of Object.entries(config?.workspaces ?? {})) {
		const declaredPath = typeof value?.path === "string" ? value.path : "";
		if (!declaredPath) continue;
		if (path.resolve(path.dirname(sovereignDir), declaredPath) === path.resolve(repoRoot)) return id;
	}
	return null;
}

/** Substitutes `SELF_WORKSPACE` in every entry's argv, dropping entries that need it when this node
 * declares no id for this checkout. The caller reports what was dropped — a silently shorter table
 * is a smaller measurement presented as the same one. */
export function withSelfWorkspace(commands, selfWorkspaceId) {
	return commands
		.filter((command) => selfWorkspaceId !== null || !command.argv.includes(SELF_WORKSPACE))
		.map((command) =>
			command.argv.includes(SELF_WORKSPACE)
				? { ...command, argv: command.argv.map((token) => (token === SELF_WORKSPACE ? selfWorkspaceId : token)) }
				: command,
		);
}

// ---- The declaration table. ----
//
// Five commands, measured by hand by the operator (2026-08-07) and reproduced by this probe.
// `context`'s allowed set is BROADER than the plan brief's starting "builtPluginPath,
// builtPluginSha" — investigated and confirmed legitimate, not a relaxation of the guard:
// `resolveOtherSovereignDirs` (apps/refarm/src/commands/context.ts) checks
// `fs.existsSync(path.join(cwd, ".refarm"))`, so `otherSovereignDirs` (and `divergences`,
// which is derived from it plus the built-plugin comparison) is, BY DESIGN, exactly as much a
// fact about the working tree as `builtPluginPath` — this repo's own checkout has a gitignored
// `.refarm/` that `~/git/rcdc5` does not, so the two fields diverge on live measurement even
// with no VPN-style defect involved. See task-1-report.md for the full field-by-field diff
// that surfaced this.
export const PROBE_COMMANDS = [
	{
		name: "backup plan",
		argv: ["backup", "plan", "--json"],
		scope: "node",
		scopeReason:
			"What a backup must contain is a fact about the NODE's home, not about where the operator happened to stand when asking. This is the command an operator runs when a machine is about to be reformatted (ISS-123), so a directory-dependent answer would produce a bundle whose completeness varied with the shell's cwd — the failure would surface on the day the backup is restored, which is the worst possible moment to learn it.",
	},
	{
		name: "credential list",
		argv: ["credential", "list", "--json"],
		scope: "node",
		scopeReason:
			"Which model accounts this node holds is a fact about its silo and its catalog, never about the shell that asked. A cwd-dependent listing would let a workspace resolve a different account depending on where the operator happened to be standing, which is the exact silent quota crossover the account contract exists to prevent (ISS-122).",
	},
	{
		name: "credential current",
		argv: ["credential", "current", "--json"],
		scope: "node",
		scopeReason:
			"Which account a dispatch would spend must not depend on the shell's cwd — that is the one selector D3 names first among those that are not selectors. A directory-dependent answer here spends the wrong quota on the wrong work and reports success while doing it.",
	},
	{
		name: "node declare",
		argv: ["node", "declare", "--json"],
		scope: "node",
		scopeReason:
			"What a node declares about itself is a fact about its home, never about the shell that asked. A cwd-dependent preview would let an operator seal a declaration describing a different node than the one he is standing up, and the error would only surface on the machine where nothing else is left to check it against.",
	},
	{
		name: "resume",
		argv: ["resume", "--json"],
		scope: "node",
		scopeReason:
			"The slice entry point CLAUDE.md section 4 mandates. Runtime, model route, session and ledger are the node's and must not move; the project block reports whichever project THIS invocation resolved, and since 2026-08-10 it says which one and how (ISS-092).",
		fieldReasons: {
			"environmentPressure.signals": "Reports live host memory AND the free space of the filesystem the command was invoked on (environmentPressure.signals[].path is the cwd), so it varies by BOTH time and directory. The control pair catches the time half only when the reading happens to move between two spawns seconds apart — which made this row flip between same and convicted (ISS-101). The directory half it could never catch. Declared with a reason rather than left to a coin flip.",
			project:
				"The project block is the handoff of the project this invocation resolved — by --workspace, by cwd-match against the declared catalog, or by convention. It varies because the project varies, and `projectResolution` beside it names which. Before ISS-092 this key simply VANISHED outside a project, so a consumer reading project?.currentTasks got an empty list and no signal; that silent absence, not the variance, was the defect.",
			projectResolution:
				"Reports which of the four states produced the block above -- read, empty, unreadable, absent -- with the workspace id, the origin and the path. It varies BY CONSTRUCTION: a field whose job is to say what this directory resolved to would be lying if it were constant.",
		},
		allowedVaryingFieldPaths: ["environmentPressure.signals", "project", "projectResolution"],
	},
	{
		// The strong claim, and the regression guard for ISS-092's fix: asked about a NAMED workspace,
		// resume must answer identically from every directory -- including the project block, which is
		// exactly what the row above is allowed to vary. This is what makes the declaration above a
		// report of real variance rather than a place to hide one.
		name: "resume --workspace <self>",
		argv: ["resume", "--workspace", SELF_WORKSPACE, "--json"],
		scope: "node",
		scopeReason:
			"An explicitly named workspace is a node-level address, so nothing at all may depend on the caller's directory -- this is the row that proves --workspace actually decouples the answer from where the operator stands.",
		fieldReasons: {
			"environmentPressure.signals": "Reports live host memory AND the free space of the filesystem the command was invoked on (environmentPressure.signals[].path is the cwd), so it varies by BOTH time and directory. The control pair catches the time half only when the reading happens to move between two spawns seconds apart — which made this row flip between same and convicted (ISS-101). The directory half it could never catch. Declared with a reason rather than left to a coin flip.",
		},
		// `projectResolution.cwd` WAS declared here and is gone: ISS-111 removed the field from a
		// flag-origin resolution, so there is nothing left to allow. An exception that outlives its
		// cause is a permission nobody is checking — the same self-expiry the brand allowlist and
		// the security gate's accepted advisories both carry.
		allowedVaryingFieldPaths: ["environmentPressure.signals"],
	},
	{
		name: "status",
		argv: ["status", "--json"],
		scope: "node",
		scopeReason:
			"The node's overall state as one answer; it names no project and must not read one.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "context",
		argv: ["context", "--json"],
		scope: "node",
		scopeReason:
			"Reports the node's base, namespace and loaded artifact — with the CLI's own directory kept as a labelled second fact, which is why four of its fields legitimately vary.",
		fieldReasons: {
			"context.builtPluginPath":
				"The built plugin is a fact about the WORKING TREE the CLI was invoked from, reported alongside the node's own loaded artifact rather than instead of it.",
			"context.builtPluginSha":
				"Same working-tree fact as builtPluginPath: its content hash, absent when the invocation directory has no build.",
			"context.otherSovereignDirs":
				"resolveOtherSovereignDirs checks fs.existsSync(path.join(cwd, '.refarm')), so this field is BY DESIGN a statement about the invocation directory; this repo's checkout has a gitignored .refarm/ that ~/git/rcdc5 does not.",
			"context.divergences":
				"Derived from otherSovereignDirs plus the built-plugin comparison, so it inherits their working-tree dependence; investigated 2026-08-07 and confirmed legitimate rather than a relaxation of the guard.",
		},
		allowedVaryingFieldPaths: [
			"context.builtPluginPath",
			"context.builtPluginSha",
			"context.otherSovereignDirs",
			"context.divergences",
		],
	},
	{
		name: "doctor",
		argv: ["doctor", "--json"],
		scope: "node",
		scopeReason:
			"Diagnoses the NODE. Its identity fields are named host.* and must not move with the caller; its scope DIAGNOSTICS compare the node against where the operator is standing, which is the feature, not a leak.",
		fieldReasons: {
			warnings:
				"Doctor's job includes comparing the NODE against where the operator is standing, so these findings differ by directory BY DESIGN. Measured 2026-08-10, and each was traced rather than assumed: scope:auth-policy-divergence and scope:config-divergence come from doctor.ts:380's operatorBase, a deliberate cwd read the 2026-08-06 two-halves-one-node slice installed precisely so the comparison exists; sovereign:plugin-unknown comes from context.ts's built-plugin comparison, which reports null rather than trusting a fallback root when the invocation directory has no build -- the same working-tree fact already declared on the `context` row. A doctor whose scope findings did not move with the directory would have stopped doing the comparison.",
			warningCount: "The count of the warnings above; it moves with them.",
			recommendations: "One entry per finding above, carrying its action and command.",
			nextAction: "The first recommendation's action, so it follows the findings.",
			nextActions: "Every recommendation's action, in the same order.",
			nextCommand: "The first recommendation's command.",
			nextCommands: "Every recommendation's command.",
			workingTree:
				"Added by ISS-093's fix: the directory the CLI was invoked from and the package manager detected THERE. It varies because the tree varies, and it carries its own `path` so the variance names itself. It exists precisely so `host` no longer has to lie — host.packageManager used to be pnpm here and npm anywhere else.",
		},
		allowedVaryingFieldPaths: [
			"nextAction",
			"nextActions",
			"nextCommand",
			"nextCommands",
			"recommendations",
			"warningCount",
			"warnings",
			"workingTree",
		],
	},
	{
		name: "model current",
		argv: ["model", "current", "--json"],
		scope: "node",
		scopeReason:
			"The model route and its credential are resolved from the node's identity, never from a directory.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "model providers",
		argv: ["model", "providers", "--json"],
		scope: "node",
		scopeReason:
			"The provider catalog and each provider's credential state belong to the node.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "plugin status",
		argv: ["plugin", "status", "--json"],
		scope: "node",
		scopeReason:
			"Which plugin the daemon has LOADED is a property of the running node.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "plugin list",
		argv: ["plugin", "list", "--json"],
		scope: "node",
		scopeReason:
			"Plugins are installed into the node's sovereign dir; the installed set and where each came from are node facts, not facts about the caller's directory.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "auth list",
		argv: ["auth", "list", "--json"],
		scope: "node",
		scopeReason:
			"Credentials are enrolled on the NODE; which ones exist does not change with the caller's directory.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "config plugins list",
		argv: ["config", "plugins", "list", "--json"],
		scope: "node",
		scopeReason:
			"The plugin declarations in the node's config. Declared node until proven otherwise -- the directional rule: a wrongly-node-declared command is convicted and corrected with evidence, the reverse is silently excused.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "requirements list",
		argv: ["requirements", "list", "--workspace", SELF_WORKSPACE, "--json"],
		scope: "node",
		scopeReason:
			"The requirement catalog is addressed through the node's declared catalog, the same way the ledger is — the counting surface must answer the same from a phone as from the checkout, which is the whole point of asking by workspace id.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "issues validate",
		argv: ["issues", "validate", "--workspace", SELF_WORKSPACE, "--json"],
		scope: "node",
		scopeReason:
			"Validates the ledger addressed through the node's declared catalog, exactly as `issues list` does.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "model doctor",
		argv: ["model", "doctor", "--json"],
		scope: "node",
		scopeReason:
			"Diagnoses the node's model route and credential.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "model env",
		argv: ["model", "env", "--json"],
		scope: "node",
		scopeReason:
			"The model-related environment this node resolves.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "process status",
		argv: ["process", "status", "--json"],
		scope: "node",
		scopeReason:
			"Processes the node is tracking.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "provision list",
		argv: ["provision", "list", "--json"],
		scope: "node",
		scopeReason:
			"What this node has provisioned.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "records analyze",
		argv: ["records", "analyze", "--json"],
		scope: "node",
		scopeReason:
			"Reads the node's graph.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "workspace mounts",
		argv: ["workspace", "mounts", "--json"],
		scope: "node",
		scopeReason:
			"Mounts are declared on the node, like workspaces themselves.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "workspace status",
		argv: ["workspace", "status", "--json"],
		scope: "node",
		scopeReason:
			"The node's view of its declared workspaces.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "hardening",
		argv: ["hardening", "--json"],
		scope: "project",
		scopeReason:
			"RECLASSIFIED 2026-08-10 by the probe, which is what the directional rule is for: declared `node` on admission, convicted on the first run, and the diverging fields say why — baseline.path, baseline.entries and every ratchet.* field are facts about the TREE being audited. It audits the working tree, so answering identically everywhere would mean it audited nothing.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "health audit",
		argv: ["health", "audit", "--json"],
		scope: "project",
		scopeReason:
			"The auditing half of `health`, which is already declared project: it inspects the tree the operator is standing in, and an identical answer from /tmp would mean it audited nothing.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "health policy",
		argv: ["health", "policy", "--json"],
		scope: "project",
		scopeReason:
			"The policy governing THIS project's health audit.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "health suggest-policy",
		argv: ["health", "suggest-policy", "--json"],
		scope: "project",
		scopeReason:
			"Suggests a policy from what it finds in THIS tree.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "project automations list",
		argv: ["project", "automations", "list", "--json"],
		scope: "project",
		scopeReason:
			"`refarm project` resolves .project/ relative to the working directory by design; answering the same everywhere would mean it stopped reading the project.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "project automations validate",
		argv: ["project", "automations", "validate", "--json"],
		scope: "project",
		scopeReason:
			"Same document, same resolution as `project automations list`.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "release check",
		argv: ["release", "check", "--json"],
		scope: "project",
		scopeReason:
			"Checks THIS repository's release readiness.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "release plan",
		argv: ["release", "plan", "--json"],
		scope: "project",
		scopeReason:
			"Plans a release of THIS repository.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "workspace execution",
		argv: ["workspace", "execution", "--json"],
		scope: "project",
		scopeReason:
			"Inspects THIS directory's package manager, turbo and cache state -- resolveWorkspaceExecutionCwd's flagless branch deliberately reads the current directory, and the 2026-08-06 slice kept it that way on purpose.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "workspace sources declarations",
		argv: ["workspace", "sources", "declarations", "--json"],
		scope: "node",
		scopeReason:
			"Advice about the NODE's catalog: which declared workspaces still lack a repository, and where that declaration belongs. Graduated from the not-yet-probed backlog when ISS-034 made its configPath the node's absolute catalog instead of a relative `.refarm/config.json`, which read as the workspace's own file — the shape the abolished-local refusal rejects in the same breath.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "workspace list",
		argv: ["workspace", "list", "--json"],
		scope: "node",
		scopeReason:
			"The workspace catalog is the NODE's, read from its declared base; which workspace the operator stands in must not change which workspaces exist.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "connection status",
		argv: ["connection", "status", "--json"],
		scope: "node",
		scopeReason:
			"host.wit's own words: a connection is 'declared by the OPERATOR ... several plugins share ONE live connection'. Node state, and the 2026-08-08 fix to connection.ts:499,830 made this row same; this entry is that fix's regression guard.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "budget observations",
		argv: ["budget", "observations", "--limit", "3", "--json"],
		scope: "node",
		scopeReason:
			"The cost record lives in the node's graph; a spend observation does not change because the reader moved.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "budget by-workspace",
		argv: ["budget", "by-workspace", "--json"],
		scope: "node",
		scopeReason:
			"An aggregate over the node's graph, grouped BY workspace — the grouping is data, not the caller's location.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "budget by-host",
		argv: ["budget", "by-host", "--json"],
		scope: "node",
		scopeReason:
			"Same graph aggregate, grouped by host.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "budget by-spawner",
		argv: ["budget", "by-spawner", "--json"],
		scope: "node",
		scopeReason:
			"Same graph aggregate, grouped by spawner.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "budget usage",
		argv: ["budget", "usage", "--json"],
		scope: "node",
		scopeReason:
			"The node's usage window. Its period bounds are computed from `now`, so they are time-variant and not directory-variant.",
		fieldReasons: {
			"usage.period.startMs":
				"The window is computed from `now` at each invocation, so both bounds move between any two spawns. DECLARED rather than left to the control pair (ISS-101): the prose here used to say the control measures it, and the control only measures it when the clock happens to tick between two spawns seconds apart. On a run where it does not, this row convicts — the verdict flips with nothing changed, and a verdict that flips is worse than one that is wrong.",
			"usage.period.endMs":
				"The other bound of the same window, moving for the same reason and declared for the same one.",
		},
		allowedVaryingFieldPaths: ["usage.period.startMs", "usage.period.endMs"],
	},
	{
		name: "task list",
		argv: ["task", "list", "--json"],
		scope: "node",
		scopeReason:
			"Efforts live in the node's queue and graph, not in a directory. Probeable since ISS-091 moved its session write behind an explicit --refresh: before that it rewrote the node's task-session file on every read, so an instrument running it four times per pass wrote four times.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "sessions list",
		argv: ["sessions", "list", "--json"],
		scope: "node",
		scopeReason:
			"Sessions live in the node's graph.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "issues list",
		argv: ["issues", "list", "--workspace", SELF_WORKSPACE, "--json"],
		scope: "node",
		scopeReason:
			"The ledger is addressed through the node's declared catalog, so it answers the same from anywhere; the workspace id comes from THIS node's declaration rather than a literal, which is what makes the row mean the same thing on any node.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "capabilities",
		argv: ["capabilities", "--json"],
		scope: "node",
		scopeReason:
			"What this build of refarm can do is a property of the binary and the node, never of the directory.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "agent",
		argv: ["agent", "--json"],
		scope: "node",
		scopeReason:
			"The agent handoff plan is derived from the node's runtime and model state.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "runtime status",
		argv: ["runtime", "status", "--json"],
		scope: "node",
		scopeReason:
			"Whether the daemon is up, and on which namespace, is the node's most basic fact.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "process list",
		argv: ["process", "list", "--json"],
		scope: "node",
		scopeReason:
			"Processes the node is tracking.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "delivery list",
		argv: ["delivery", "list", "--json"],
		scope: "node",
		scopeReason:
			"Delivery adapters are declared on the node.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "records list",
		argv: ["records", "list", "--json"],
		scope: "node",
		scopeReason:
			"Records live in the node's graph.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "vault list",
		argv: ["vault", "list", "--json"],
		scope: "node",
		scopeReason:
			"Vaults are declared on the node, like workspaces.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "skill list",
		argv: ["skill", "list", "--json"],
		scope: "node",
		scopeReason:
			"Skills are installed into the node's sovereign dir.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "extension list",
		argv: ["extension", "list", "--json"],
		scope: "node",
		scopeReason:
			"Extensions are installed into the node's sovereign dir.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "theme list",
		argv: ["theme", "list", "--json"],
		scope: "node",
		scopeReason:
			"Themes ship with the binary and are selected on the node.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "tree list",
		argv: ["tree", "list", "--json"],
		scope: "node",
		scopeReason:
			"Trees are addressed through the node's graph.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "inspect",
		argv: ["inspect", "--json"],
		scope: "node",
		scopeReason:
			"Inspects the node. Everything it reports is the node's except the timestamp of the inspection itself.",
		fieldReasons: {
			createdAt:
				"Stamped when the inspection runs, so it differs between any two invocations regardless of where they ran. DECLARED rather than left to the control pair (ISS-101), for the same reason as `budget usage`: the control catches this only when two spawns land in different milliseconds, and a field excluded by luck is included by luck on the next run.",
		},
		allowedVaryingFieldPaths: ["createdAt"],
	},
	{
		name: "surface list",
		argv: ["surface", "list", "--json"],
		scope: "node",
		scopeReason:
			"Surfaces are the node's operator projections (Termux, PWA, Telegram). A surface catalog that changes with the caller's directory is reading a fixture, which is the exact defect the 2026-08-07 slice named when a repo-local .refarm/ was mistaken for the node's catalog.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "actions",
		argv: ["actions", "--json"],
		scope: "node",
		scopeReason:
			"The action catalog is derived from the binary and the node's declared capabilities.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "check --next-action",
		argv: ["check", "--next-action", "--json"],
		scope: "project",
		scopeReason:
			"The composite gate answers 'is THIS project ready to work in' — it reads the working tree's dependency and build state, so refusing outside a project is correct and answering identically everywhere would mean it stopped looking at the project.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "health",
		argv: ["health", "--json"],
		scope: "project",
		scopeReason:
			"Audits the filesystem structure, build alignment and resolution state of the project the operator is standing in; its findings are about that tree, and an identical answer from /tmp would mean it audited nothing.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "project handoff validate",
		argv: ["project", "handoff", "validate", "--json"],
		scope: "project",
		scopeReason:
			"refarm project resolves .project/ relative to the working directory BY DESIGN; refusing outside a project is the correct answer, and answering the same everywhere would mean it stopped reading the project.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "package-manager",
		argv: ["package-manager", "--json"],
		scope: "project",
		scopeReason:
			"Detects which package manager THIS tree uses (pnpm here, npm elsewhere). Varying by directory is the whole point; what is wrong is doctor reporting the same value under a host.* name.",
		allowedVaryingFieldPaths: [],
	},
];

// ---- Impure edge: everything below spawns a process or touches the filesystem. ----

/** Runs the built CLI's `argv` from `cwd` with a timeout, returning a `ran(...)`/`unrunnable(...)`
 * answer entry directly. Never throws — every failure mode (missing binary, non-zero exit,
 * timeout, non-JSON stdout) becomes `unrunnable(reason)` rather than an exception, so callers
 * never need a try/catch around this. */
export function runCliFromDirectory(
	cwd,
	argv,
	{
		cliPath = CLI_PATH,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		execPath = process.execPath,
		// DECLARED, not inherited. The probe used to let every spawn pick up this shell's
		// environment, which is fine for a local run against the operator's own node and is
		// exactly what made the instrument unusable anywhere else: on a machine with no node the
		// answers are all empty, and two empty answers agree. Passing a seeded environment is
		// what lets `same` mean agreement between two POPULATED answers (ISS-097).
		env = process.env,
	} = {},
) {
	if (!fs.existsSync(cwd)) return unrunnable(`directory does not exist: ${cwd}`);
	if (!fs.existsSync(cliPath)) return unrunnable(`CLI not built: ${cliPath} does not exist`);

	const result = spawnSync(execPath, [cliPath, ...argv], {
		cwd,
		encoding: "utf8",
		timeout: timeoutMs,
		env,
	});

	if (result.error) return unrunnable(`spawn error: ${result.error.message}`);
	if (result.signal) return unrunnable(`killed by signal ${result.signal} (likely timeout)`);

	// PARSE FIRST, exit code second (ISS-098). A non-zero exit with a valid envelope is an ANSWER —
	// `refarm health --json` exits 1 when it finds issues and prints the whole report — and treating
	// it as "did not run" discarded the evidence and produced the right verdict for the wrong reason.
	// The exit code travels with the answer and is compared like any other field.
	const stdout = (result.stdout || "").trim();
	if (!stdout) {
		const stderr = (result.stderr || "").trim().slice(0, 300);
		return unrunnable(`exit code ${result.status}, empty stdout${stderr ? `: ${stderr}` : ""}`);
	}
	try {
		return ran(JSON.parse(stdout), result.status ?? 0);
	} catch {
		const stderr = (result.stderr || "").trim().slice(0, 200);
		return unrunnable(
			`stdout was not valid JSON (exit ${result.status}): ${stdout.slice(0, 160)}${stderr ? ` | ${stderr}` : ""}`,
		);
	}
}

/**
 * The node's sovereign dir, as an OBSERVATION TARGET — never as a resolver anything acts on. The
 * home is a REQUIRED parameter with no default, which is the shape
 * `docs/superpowers/plans/2026-08-07-no-resolver-defaults-to-the-os.md` prescribes for a site that
 * legitimately needs it: "an EXPLICIT resolver call, not a silent default". A default here would
 * add a counted site to `scripts/no-os-resolution.mjs`'s ratchet, and it would do it inside the
 * instrument built to hunt that exact shape.
 */
export function observedSovereignDir(homedir) {
	const declared = process.env.REFARM_HOME?.trim();
	return declared ? declared : path.join(homedir, ".refarm");
}

/** PURE. The paths whose size-or-mtime fingerprint changed, appeared or vanished between two
 * snapshots. Additions and removals count: a probe run that DELETES something on the node is at
 * least as interesting as one that writes. */
export function diffSnapshots(before, after) {
	const paths = new Set([...before.keys(), ...after.keys()]);
	return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

/** Fingerprints every file under `root` as `mtimeMs:size`. A missing root is an EMPTY snapshot, not
 * an error — a node with no sovereign dir yet is a legitimate state, and the diff against a later
 * snapshot still reports whatever appeared. */
export function snapshotDirectory(root) {
	const snapshot = new Map();
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile()) {
				try {
					const stat = fs.statSync(full);
					snapshot.set(full, `${stat.mtimeMs}:${stat.size}`);
				} catch {
					/* raced with a writer; the next run sees it */
				}
			}
		}
	};
	walk(root);
	return snapshot;
}

/**
 * The probe's second directory: another DECLARED workspace, read from the node's own catalog rather
 * than guessed from a path that looks right.
 *
 * This function exists because the guess was wrong. Until 2026-08-10 the probe used
 * `~/git/rcdc5` — the PARENT of the declared workspace `~/git/rcdc5/rcdc5` — so it ran from inside
 * ONE workspace and two directories that are inside none. Every resolver's cwd-match branch, the
 * branch that decides which project, which ledger and which budget policy answer, was never
 * exercised from a second workspace at all. The probe was measuring "workspace vs nowhere" and
 * reporting it as directory independence.
 *
 * Returns `null` rather than a fallback when the catalog cannot be read or declares nothing but this
 * checkout: a probe that quietly substituted some other directory would go back to measuring
 * something other than what it says.
 */
export function declaredSecondWorkspace(sovereignDir, repoRoot, { readFile = (p) => fs.readFileSync(p, "utf8") } = {}) {
	let config;
	try {
		config = JSON.parse(readFile(path.join(sovereignDir, "config.json")));
	} catch {
		return null;
	}
	for (const [id, value] of Object.entries(config?.workspaces ?? {})) {
		const declaredPath = typeof value?.path === "string" ? value.path : "";
		if (!declaredPath) continue;
		const resolved = path.resolve(path.dirname(sovereignDir), declaredPath);
		if (resolved !== path.resolve(repoRoot)) return { id, path: resolved };
	}
	return null;
}

/** True when `dir` exists and is a readable directory — used to validate the operator's
 * real work repository (`~/git/rcdc5`) before trusting it as the third probe directory. */
function isReadableDirectory(dir) {
	try {
		return fs.statSync(dir).isDirectory() && fs.accessSync(dir, fs.constants.R_OK) === undefined;
	} catch {
		return false;
	}
}

/**
 * Resolves the three directories the probe runs from: this repo checkout, the operator's real
 * work repository (`~/git/rcdc5`), and a directory with no relationship to refarm at all
 * (`os.tmpdir()`). If `~/git/rcdc5` does not exist or is not readable, a different real
 * directory (the operator's home) stands in for it rather than silently dropping to two
 * directories — the multi-directory property is what makes the probe meaningful at all.
 */
export function resolveProbeDirectories({
	repoRoot = REPO_ROOT,
	homedir = os.homedir(),
	tmpdir = os.tmpdir(),
	secondWorkspace = declaredSecondWorkspace(observedSovereignDir(homedir), repoRoot),
	exists = isReadableDirectory,
} = {}) {
	// THREE KINDS OF DIRECTORY, and each earns its place: this checkout (a declared workspace),
	// somewhere unrelated to refarm entirely (/tmp), and ANOTHER declared workspace. The third used
	// to be `~/git/rcdc5` — the parent of the declared workspace, inside no workspace at all — so
	// two of the three were "nowhere" and no resolver's cwd-match branch was ever exercised against
	// a second workspace. The label carries the workspace id so the report says which one answered.
	const directories = { repo: repoRoot, tmp: tmpdir };
	if (secondWorkspace && exists(secondWorkspace.path)) {
		directories[`workspace:${secondWorkspace.id}`] = secondWorkspace.path;
	} else {
		// Named, never silent: a two-directory run measures less, and the header must say so rather
		// than let a missing workspace read as a clean three-directory result.
		directories["home (no second workspace declared)"] = homedir;
	}
	return directories;
}

/**
 * A NODE WITH SOMETHING IN IT — the fixture ISS-097 said this instrument was waiting for.
 *
 * The probe's verdict is only as strong as the node it was taken on, and that is not a caveat,
 * it is the thing that kept it out of CI. Measured 2026-08-10 under an empty home: `workspace
 * list` returns `[]` from every directory and scores `same`, `connection status` does the same.
 * Two absences agreeing is not independence, it is a step that measured nothing — the precise
 * defect this instrument exists to find, manufactured inside the instrument.
 *
 * So: a real base, a real `.refarm/config.json`, TWO declared workspaces that are real
 * directories, a surface and a connection. Every node-scoped answer is then non-empty, and
 * `same` means two populated answers agreed.
 *
 * No daemon. Deliberately: everything seeded here is read from the filesystem, so the fixture is
 * honest about which half of the probe it enables. A runtime-backed command run against this
 * fixture is measuring an absent daemon, and `runProbeAgainstSeededNode` says so rather than
 * counting it.
 *
 * Returns `{ base, env, directories, cleanup }`. `env` is a COMPLETE environment for a spawn —
 * `process.env` plus the declarations — not a fragment to merge, because a fragment is how a
 * spawn ends up half seeded and half inherited.
 */
export function seedNodeFixture({ tmpRoot = os.tmpdir(), env = process.env } = {}) {
	const base = fs.mkdtempSync(path.join(fs.realpathSync(tmpRoot), "refarm-probe-node-"));
	const alpha = fs.mkdtempSync(path.join(fs.realpathSync(tmpRoot), "refarm-probe-alpha-"));
	const beta = fs.mkdtempSync(path.join(fs.realpathSync(tmpRoot), "refarm-probe-beta-"));
	const sovereignDir = ".refarm";
	fs.mkdirSync(path.join(base, sovereignDir), { recursive: true });
	fs.writeFileSync(
		path.join(base, sovereignDir, "config.json"),
		`${JSON.stringify(
			{
				node: { name: "probe-fixture" },
				workspaces: {
					alpha: { path: alpha, kind: "consumer" },
					beta: { path: beta, kind: "consumer" },
				},
				surfaces: { "sidecar-http": { expose: "loopback", gate: "none" } },
				// A declared connection so `connection status` answers with something. The command
				// probes the binary and reports `down`/`unknown`; that IS a populated answer, and
				// it is the shape the empty-home run could never produce.
				connections: {
					probe: { establish: ["/bin/true"], probe: { run: ["/bin/true"] } },
				},
			},
			null,
			2,
		)}\n`,
	);
	return {
		base,
		alpha,
		beta,
		/** What `<self>` resolves to here. `withSelfWorkspace` needs a REAL declared id, and the
		 *  fixture is the only thing that knows one. */
		selfWorkspace: "alpha",
		env: {
			...env,
			SOVEREIGN_BASE: base,
			SOVEREIGN_DIR: sovereignDir,
			REFARM_HOME: path.join(base, sovereignDir),
		},
		// The two declared workspaces plus somewhere that is neither, which is the same three
		// kinds `resolveProbeDirectories` uses against a real node.
		directories: { "workspace:alpha": alpha, "workspace:beta": beta, outside: fs.realpathSync(tmpRoot) },
		cleanup() {
			for (const dir of [base, alpha, beta]) fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

/**
 * Run a subset of the probe against a seeded node and report BOTH things a verdict needs: that
 * the answers agreed, and that there was something to agree about.
 *
 * `populated` is the half the empty-home run could never have. A row where every directory
 * answered with an empty collection is reported as `empty`, NOT as `same` — because that is what
 * kept this instrument out of CI, and folding it back into `same` here would re-manufacture the
 * defect one layer up.
 */
export function runProbeAgainstSeededNode(commands, fixture, options = {}) {
	// `<self>` MUST be substituted, and forgetting it does not fail loudly — it asks about a
	// workspace that does not exist, which produces a real-looking `differs-undeclared` on
	// `projectResolution.cwd`. It did, on this function's first run, and the row read exactly
	// like a defect. A fixture that can manufacture a conviction is worse than no fixture.
	const resolved = withSelfWorkspace(commands, fixture.selfWorkspace);
	const rows = runProbe(resolved, fixture.directories, { ...options, env: fixture.env });
	return rows.map((row) => {
		const answers = Object.values(row.byDirectory);
		const populated = answers.some((answer) => answer.status === "ran" && hasContent(answer.value));
		return { ...row, populated, verdict: populated ? row.verdict : "empty" };
	});
}

/** PURE. Whether a parsed answer says anything at all — an envelope whose every collection is
 *  empty is an absence wearing an answer's shape. Scalars and non-empty collections count; the
 *  envelope's own bookkeeping keys (`ok`, `command`, `nextCommand`…) are present on every reply
 *  and therefore cannot distinguish one. */
export function hasContent(value) {
	if (value === null || value === undefined) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value !== "object") return true;
	const BOOKKEEPING = new Set([
		"ok",
		"command",
		"operation",
		"action",
		"status",
		"nextAction",
		"nextActions",
		"nextCommand",
		"nextCommands",
		"writes",
		"effects",
	]);
	return Object.entries(value).some(([key, nested]) => !BOOKKEEPING.has(key) && hasContent(nested));
}

/** Runs every command in `commands` from every directory in `directories`, compares, and
 * returns one row per command: `{ name, verdict, fieldPaths, unrunnableDirectories, byDirectory }`. */
export function runProbe(commands = PROBE_COMMANDS, directories = resolveProbeDirectories(), options = {}) {
	// The guard lives HERE, not only in `main()`, because `runProbe` is called directly — the
	// burn-down re-probes a single filtered command that way, and this plan's own text told it to.
	// An entry with no scope would otherwise fall through `judge`'s node branch and produce a
	// verdict nobody declared, which is the same "a signal claiming more than it measured" shape
	// this instrument exists to catch.
	const declarationErrors = validateDeclarations(commands);
	if (declarationErrors.length > 0) {
		throw new Error(`malformed probe declaration(s):\n  - ${declarationErrors.join("\n  - ")}`);
	}

	const [controlLabel] = Object.keys(directories);
	return commands.map((command) => {
		const byDirectory = {};
		for (const [label, dir] of Object.entries(directories)) {
			byDirectory[label] = runCliFromDirectory(dir, command.argv, options);
		}

		// THE CONTROL PAIR. A second run from the SAME directory, so a field that moves on its own
		// (a clock, a free-memory reading, an `ageMs`) is measured as time-variant rather than
		// mistaken for directory-variance. Four of the 36 probeable invocations do this — measured
		// 2026-08-10 — and without the control each would be convicted for owning a clock.
		const control = runCliFromDirectory(directories[controlLabel], command.argv, options);
		const inPlaceVarying =
			byDirectory[controlLabel].status === "ran" && control.status === "ran"
				? divergingPaths({ first: byDirectory[controlLabel], second: control })
				: [];

		const result = compareAnswers(byDirectory, command, inPlaceVarying);
		// `scope` travels with the row because the row is what gets judged and summarised — a
		// verdict without its scope is not enough to say whether it passed.
		return { name: command.name, scope: command.scope, ...result, byDirectory };
	});
}

/** Renders `runProbe`'s rows as the markdown table used in reports and printed by the CLI entry
 * point below. Scope and judgement are their own columns rather than folded into the verdict: a
 * reader must be able to see that a `differs-undeclared` row PASSED because the command is
 * project-scoped, and disagree with the scope if they think it is wrong. */
export function formatProbeTable(rows) {
	const lines = ["| Command | Scope | Verdict | Judgement | Notes |", "| --- | --- | --- | --- | --- |"];
	for (const row of rows) {
		let notes = "";
		if (row.verdict === "unrunnable-somewhere") {
			notes = `unrunnable in: ${row.unrunnableDirectories.join(", ")}`;
		} else if (row.verdict === "unproven") {
			notes = `never ran: ${row.unrunnableDirectories.join(", ")}`;
		} else if (row.fieldPaths.length > 0) {
			notes = row.fieldPaths.join(", ");
		}
		// Always printed, on every row, even a `same` one: a verdict reached by EXCLUDING fields
		// must show what it excluded, or `same` reads as byte-identical when it is not.
		if (row.inPlaceFieldPaths?.length > 0) {
			notes += `${notes ? " · " : ""}time-variant, excluded: ${row.inPlaceFieldPaths.join(", ")}`;
		}
		const judgement = judge(row.verdict, row.scope);
		lines.push(
			`| \`${row.name}\` | ${row.scope ?? "?"} | ${row.verdict} | ${judgement === "convicted" ? "**CONVICTED**" : "pass"} | ${notes} |`,
		);
	}
	return lines.join("\n");
}

function main() {
	// The declaration guard runs BEFORE anything is probed. A malformed table would otherwise
	// produce a full run of verdicts whose judgements cannot be trusted — and the expensive part
	// (three spawns per command) would already have been paid.
	// ISONOMY: the id for this checkout comes from THIS node's catalog, never from a literal in the
	// table. A node that declares no id for this checkout loses that one row, and is told so —
	// a shorter table presented as the same measurement is the defect this probe exists to find.
	const selfWorkspaceId = declaredSelfWorkspace(observedSovereignDir(os.homedir()), REPO_ROOT);
	const commands = withSelfWorkspace(PROBE_COMMANDS, selfWorkspaceId);
	if (commands.length < PROBE_COMMANDS.length) {
		process.stdout.write(
			`directory-independence: ${PROBE_COMMANDS.length - commands.length} command(s) skipped — this checkout is not a declared workspace on this node.\n`,
		);
	}

	const declarationErrors = validateDeclarations(commands);
	if (declarationErrors.length > 0) {
		process.stderr.write(`directory-independence: ${declarationErrors.length} malformed declaration(s)\n`);
		for (const message of declarationErrors) process.stderr.write(`  - ${message}\n`);
		process.exitCode = 1;
		return;
	}

	const directories = resolveProbeDirectories();
	process.stdout.write(
		`directory-independence: probing ${commands.length} command(s) from ` +
			`${Object.entries(directories)
				.map(([label, dir]) => `${label}=${dir}`)
				.join(", ")}\n\n`,
	);
	// The read-only rule, observed rather than promised. `refarm task list --json` rewrites
	// ~/.refarm/sessions/task-session.v1.json on every read — measured 2026-08-10 — and it looks
	// read-only from every angle a reviewer has. A probe that runs a mutating command writes to the
	// operator's real node three times per invocation, forever.
	const sovereignDir = observedSovereignDir(os.homedir());
	const before = snapshotDirectory(sovereignDir);

	const rows = runProbe(commands, directories);
	process.stdout.write(`${formatProbeTable(rows)}\n`);

	// WARNS, never blocks: the daemon shares this directory and may legitimately write while the
	// probe runs, so a blocking check here would fire on the environment and train its reader to
	// ignore it. Naming the files is what makes it actionable — that is how `task list` was caught.
	const touched = diffSnapshots(before, snapshotDirectory(sovereignDir));
	if (touched.length > 0) {
		process.stdout.write(
			`\nWARNING: ${touched.length} file(s) under ${sovereignDir} changed during this run.\n` +
				`A probed command may not be read-only (or the daemon wrote concurrently):\n` +
				`${touched.map((p) => `  - ${p}`).join("\n")}\n`,
		);
	}

	// FOUR COUNTS, never one. `declared` is not folded into `same` and `unproven` is folded into
	// neither, so a green line cannot hide either a surface declared into compliance or a surface
	// that was never measured.
	const summary = summarise(rows);
	process.stdout.write(
		`\ndirectory-independence: ${summary.probed} probed · ${summary.same} same · ` +
			`${summary.declared} declared · ${summary.convicted} convicted · ${summary.unproven} unproven\n`,
	);
	// The caveat is printed by the TOOL, not left in a spec, because the number above is the part
	// people quote. MEASURED 2026-08-10 with an empty REFARM_HOME: `workspace list` and
	// `connection status` return `[]` from every directory and score `same` — agreement between two
	// absences, which is why this probe is a LOCAL instrument against a real node and is deliberately
	// not wired into CI (ISS-097).
	process.stdout.write(
		"A verdict is only as strong as the node it was taken on: a node with an empty catalog answers\n" +
			"emptily from every directory, and that reads as `same`. Run this against a real node.\n",
	);

	const convicted = rows.filter((row) => judge(row.verdict, row.scope) === "convicted");
	if (convicted.length > 0) {
		process.stdout.write(`\n${convicted.length} command(s) convicted: ${convicted.map((r) => r.name).join(", ")}\n`);
		process.exitCode = 1;
	}
	// `unproven` does NOT fail the run — nothing was measured, which is not a defect — but it is
	// stated, because a summary that stayed silent about it would let "green" be read as "the
	// surface is directory-independent" when it means "the part that ran is".
	if (summary.unproven > 0) {
		const unproven = rows.filter((row) => row.verdict === "unproven");
		process.stdout.write(
			`\n${summary.unproven} command(s) unproven (never ran anywhere): ${unproven.map((r) => r.name).join(", ")}\n`,
		);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
