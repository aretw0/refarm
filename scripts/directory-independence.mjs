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
 * Returns `{ verdict, fieldPaths, unrunnableDirectories }`:
 *   - `verdict` is exactly one of `"same" | "differs-as-declared" | "differs-undeclared" |
 *     "unrunnable"`.
 *   - `unrunnable` FIRST — before any comparison — whenever any directory's entry is
 *     `unrunnable(...)`. A command that crashed in one directory produced no answer to compare;
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
export function compareAnswers(byDirectory, declaration) {
	const labels = Object.keys(byDirectory);
	const unrunnableDirectories = labels.filter((label) => byDirectory[label].status === "unrunnable").sort();
	if (unrunnableDirectories.length > 0) {
		return { verdict: "unrunnable", fieldPaths: [], unrunnableDirectories };
	}

	const allPaths = new Set();
	for (const label of labels) {
		collectLeafPaths(byDirectory[label].value, "", allPaths);
	}
	// A top-level object's keys come out clean ("foo", not ".foo" — the empty root prefix is
	// falsy, so `collectLeafPaths` uses the bare key for the first level). The one path this
	// filters out is a bare "" — what `collectLeafPaths` would add if a command's TOP-LEVEL
	// answer were itself an array or a primitive rather than an object, which none of the
	// probed `--json` commands' answers are, but a future command's could be.
	const normalizedPaths = [...allPaths].filter((p) => p !== "");

	const divergingPaths = normalizedPaths.filter((fieldPath) => {
		const values = labels.map((label) => getAtPath(byDirectory[label].value, fieldPath));
		return values.some((v) => !valuesEqual(v, values[0]));
	});

	if (divergingPaths.length === 0) {
		return { verdict: "same", fieldPaths: [], unrunnableDirectories: [] };
	}

	const allowed = declaration.allowedVaryingFieldPaths ?? [];
	const undeclared = divergingPaths.filter((fieldPath) => !isDeclaredPath(fieldPath, allowed));

	if (undeclared.length > 0) {
		return { verdict: "differs-undeclared", fieldPaths: undeclared.sort(), unrunnableDirectories: [] };
	}
	return { verdict: "differs-as-declared", fieldPaths: divergingPaths.sort(), unrunnableDirectories: [] };
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
	{ name: "workspace list", argv: ["workspace", "list", "--json"], allowedVaryingFieldPaths: [] },
	{ name: "model current", argv: ["model", "current", "--json"], allowedVaryingFieldPaths: [] },
	{ name: "plugin status", argv: ["plugin", "status", "--json"], allowedVaryingFieldPaths: [] },
	{
		name: "context",
		argv: ["context", "--json"],
		allowedVaryingFieldPaths: [
			"context.builtPluginPath",
			"context.builtPluginSha",
			"context.otherSovereignDirs",
			"context.divergences",
		],
	},
	{ name: "connection status", argv: ["connection", "status", "--json"], allowedVaryingFieldPaths: [] },
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
	return commands.map((command) => {
		const byDirectory = {};
		for (const [label, dir] of Object.entries(directories)) {
			byDirectory[label] = runCliFromDirectory(dir, command.argv, options);
		}
		const result = compareAnswers(byDirectory, command);
		return { name: command.name, ...result, byDirectory };
	});
}

/** Renders `runProbe`'s rows as the markdown table used in reports and printed by the CLI
 * entry point below. */
export function formatProbeTable(rows) {
	const lines = ["| Command | Verdict | Notes |", "| --- | --- | --- |"];
	for (const row of rows) {
		let notes = "";
		if (row.verdict === "unrunnable") {
			notes = `unrunnable in: ${row.unrunnableDirectories.join(", ")}`;
		} else if (row.fieldPaths.length > 0) {
			notes = row.fieldPaths.join(", ");
		}
		lines.push(`| \`${row.name}\` | ${row.verdict} | ${notes} |`);
	}
	return lines.join("\n");
}

function main() {
	const directories = resolveProbeDirectories();
	process.stdout.write(
		`directory-independence: probing ${PROBE_COMMANDS.length} command(s) from ` +
			`${Object.entries(directories)
				.map(([label, dir]) => `${label}=${dir}`)
				.join(", ")}\n\n`,
	);
	const rows = runProbe(PROBE_COMMANDS, directories);
	process.stdout.write(`${formatProbeTable(rows)}\n`);

	const bad = rows.filter((r) => r.verdict === "differs-undeclared" || r.verdict === "unrunnable");
	if (bad.length > 0) {
		process.stdout.write(
			`\n${bad.length} command(s) failed the probe: ${bad.map((r) => r.name).join(", ")}\n`,
		);
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
