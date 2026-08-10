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

/** Wraps a successfully parsed JSON answer. */
export function ran(value) {
	return { status: "ran", value };
}

/** Wraps a directory where the command produced no comparable answer (crash, timeout, non-JSON
 * stdout, non-zero exit). `reason` is free text for the report table, not matched on. */
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
export function divergingPaths(byDirectory) {
	const labels = Object.keys(byDirectory);
	const allPaths = new Set();
	for (const label of labels) collectLeafPaths(byDirectory[label].value, "", allPaths);
	return [...allPaths]
		.filter((p) => p !== "")
		.filter((fieldPath) => {
			const values = labels.map((label) => getAtPath(byDirectory[label].value, fieldPath));
			return values.some((v) => !valuesEqual(v, values[0]));
		});
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
		return { verdict: "unproven", fieldPaths: [], inPlaceFieldPaths: [], unrunnableDirectories };
	}
	if (unrunnableDirectories.length > 0) {
		return { verdict: "unrunnable-somewhere", fieldPaths: [], inPlaceFieldPaths: [], unrunnableDirectories };
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

	if (measurable.length === 0) {
		return { verdict: "same", fieldPaths: [], inPlaceFieldPaths: inPlace, unrunnableDirectories: [] };
	}

	const allowed = declaration.allowedVaryingFieldPaths ?? [];
	const undeclared = measurable.filter((fieldPath) => !isDeclaredPath(fieldPath, allowed));

	if (undeclared.length > 0) {
		return {
			verdict: "differs-undeclared",
			fieldPaths: undeclared.sort(),
			inPlaceFieldPaths: inPlace,
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
		name: "workspace list",
		argv: ["workspace", "list", "--json"],
		scope: "node",
		scopeReason:
			"The workspace catalog is the NODE's, read from its declared base; which workspace the operator is standing in must not change which workspaces exist.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "model current",
		argv: ["model", "current", "--json"],
		scope: "node",
		scopeReason: "The model route and its credential are resolved from the node's identity, never from a directory.",
		allowedVaryingFieldPaths: [],
	},
	{
		name: "plugin status",
		argv: ["plugin", "status", "--json"],
		scope: "node",
		scopeReason: "Plugins are installed into the node's sovereign dir; the loaded set is a property of the node.",
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
		name: "connection status",
		argv: ["connection", "status", "--json"],
		scope: "node",
		scopeReason:
			"host.wit's own words: a connection is 'declared by the OPERATOR ... several plugins share ONE live connection'. It is node state, and the 2026-08-08 fix to connection.ts:499,830 is what made this row `same`; this entry is that fix's regression guard.",
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
	{ cliPath = CLI_PATH, timeoutMs = DEFAULT_TIMEOUT_MS, execPath = process.execPath } = {},
) {
	if (!fs.existsSync(cwd)) return unrunnable(`directory does not exist: ${cwd}`);
	if (!fs.existsSync(cliPath)) return unrunnable(`CLI not built: ${cliPath} does not exist`);

	const result = spawnSync(execPath, [cliPath, ...argv], {
		cwd,
		encoding: "utf8",
		timeout: timeoutMs,
	});

	if (result.error) return unrunnable(`spawn error: ${result.error.message}`);
	if (result.signal) return unrunnable(`killed by signal ${result.signal} (likely timeout)`);
	if (result.status !== 0) {
		const stderr = (result.stderr || "").trim().slice(0, 300);
		return unrunnable(`exit code ${result.status}${stderr ? `: ${stderr}` : ""}`);
	}

	const stdout = (result.stdout || "").trim();
	if (!stdout) return unrunnable("empty stdout");
	try {
		return ran(JSON.parse(stdout));
	} catch {
		return unrunnable(`stdout was not valid JSON: ${stdout.slice(0, 200)}`);
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
	rcdc5Dir = path.join(homedir, "git", "rcdc5"),
	exists = isReadableDirectory,
} = {}) {
	const directories = { repo: repoRoot, tmp: tmpdir };
	if (exists(rcdc5Dir)) {
		directories.rcdc5 = rcdc5Dir;
	} else {
		directories["home (rcdc5 unavailable)"] = homedir;
	}
	return directories;
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
	const declarationErrors = validateDeclarations(PROBE_COMMANDS);
	if (declarationErrors.length > 0) {
		process.stderr.write(`directory-independence: ${declarationErrors.length} malformed declaration(s)\n`);
		for (const message of declarationErrors) process.stderr.write(`  - ${message}\n`);
		process.exitCode = 1;
		return;
	}

	const directories = resolveProbeDirectories();
	process.stdout.write(
		`directory-independence: probing ${PROBE_COMMANDS.length} command(s) from ` +
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

	const rows = runProbe(PROBE_COMMANDS, directories);
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
