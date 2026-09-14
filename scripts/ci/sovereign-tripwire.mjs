#!/usr/bin/env node
/**
 * A TRIPWIRE ON THE OPERATOR'S SOURCE OF TRUTH, for the test runner that has no containment.
 *
 * ## The incident this exists for
 *
 * Twice now a test has written into the operator's live configuration. ISS-109 deleted a key from
 * `~/.refarm/config.json`. ISS-121 put a conformance test's sentinel —
 * `__refarm_ancestor_option_probe__` — into `~/.silo/identity.json`, in three fields, where it sat
 * as his configured model for over a day. Neither was noticed by any gate. Both were found by a
 * human reading output that looked wrong.
 *
 * `@refarm.dev/vtconfig` closed that for vitest by REDIRECTING HOME at a disposable tree. The
 * `scripts/` suites do not run under vitest — they are 90 `node --test` entries in the root
 * `package.json`, invoked by `run-script-tests.mjs`, with no containment of any kind.
 *
 * ## Why this is a tripwire and not containment
 *
 * MEASURED 2026-08-12, by running all 90 script suites with HOME pointed at a disposable tree and
 * listing what landed there: 89 green, 1 red (`gate:smoke:runtime`), and 28,759 files written —
 * every one of them a TOOLCHAIN cache. `.cargo` (23,422), `.rustup` (4,774), `.cache/node`
 * corepack (560), `.config/astro` (3). Zero `.refarm`. Zero `.silo`.
 *
 * So redirecting HOME for these suites would buy nothing that was measured, and cost a full Rust
 * toolchain re-download on every run — the probe demonstrated that cost by paying it. The suites
 * do write to HOME constantly; what they write is the toolchain's own state, which is exactly what
 * HOME is for.
 *
 * A tripwire is the proportionate shape: a handful of `stat`+`hash` pairs around a run that already
 * takes minutes, watching the files that have actually been damaged.
 *
 * ## What it does NOT see, said plainly
 *
 * It watches NAMED files. A suite that writes a third sovereign path — a new store, a plugin's
 * own state, a credential file nobody has invented yet — passes this silently. That is a real
 * limit, not a hedge: the honest fix when a new sovereign file appears is to add it here, and
 * `witnessedPaths()` exists so a caller can print what is actually being watched rather than
 * assume it is everything.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The files a test must never touch, relative to the operator's home.
 *
 * Every one of these has been written to by a test suite. Adding to this list is cheap and the
 * right move the moment a new sovereign store appears — a file that is not named here is not
 * watched.
 */
export const SOVEREIGN_WITNESS_FILES = [
	".silo/identity.json",
	".refarm/config.json",
	// THE NODE'S DATABASE, in both places one has been found. Added 2026-08-12 after
	// `refarm context --inventory` measured 67 files in ~/.local/share/refarm of which 65 are
	// scratch and test leftovers — proof that suites DO write to a third sovereign location, which
	// this file's own "what it does NOT see" note had named as a limit hours earlier.
	//
	// TWO PATHS FOR ONE NAMESPACE because the operator's node has exactly that: the live database
	// is under `.refarm/data/refarm/` while the path the Rust source documents,
	// `.local/share/refarm/`, held a copy a week stale. Watching only the documented one would
	// have watched the wrong file.
	//
	// The CONVENTIONAL namespace only. A node running under another namespace is not watched here,
	// and that is a real limit rather than a hedge — the tripwire cannot resolve a node's namespace
	// without the node.
	".refarm/data/refarm/default.db",
	".local/share/refarm/default.db",
];

/** PURE. The absolute paths this tripwire watches, given a home. */
export function witnessedPaths(home = os.homedir()) {
	return SOVEREIGN_WITNESS_FILES.map((relative) => path.join(home, relative));
}

/**
 * Read one witness. THREE STATES, because "the file is not there" and "the file is there and I
 * could not read it" are different facts with different meanings — a tripwire that folded an
 * unreadable file into `absent` would report a breach every time permissions changed, and one
 * that folded it into `present` would compare `undefined` to `undefined` and never fire.
 */
export function readWitness(file, readFile = (p) => fs.readFileSync(p)) {
	try {
		return { file, state: "present", digest: createHash("sha256").update(readFile(file)).digest("hex") };
	} catch (error) {
		const code = error && typeof error === "object" ? error.code : undefined;
		if (code === "ENOENT") return { file, state: "absent", digest: null };
		return { file, state: "unreadable", digest: null, reason: code ?? String(error) };
	}
}

/** Capture every witness at one instant. */
export function captureWitnesses(home = os.homedir(), readFile) {
	return witnessedPaths(home).map((file) => readWitness(file, readFile));
}

/**
 * PURE. What changed between two captures, and what to call it.
 *
 * An `unreadable` on either side yields no verdict rather than a false one: the tripwire did not
 * look successfully, which is the third state this repository keeps refusing to round off.
 */
export function compareWitnesses(before, after) {
	const changes = [];
	const afterByFile = new Map(after.map((entry) => [entry.file, entry]));
	for (const was of before) {
		const now = afterByFile.get(was.file);
		if (!now) continue;
		if (was.state === "unreadable" || now.state === "unreadable") {
			changes.push({ file: was.file, change: "unverifiable", reason: was.reason ?? now.reason });
			continue;
		}
		if (was.state === "absent" && now.state === "present") {
			changes.push({ file: was.file, change: "created" });
		} else if (was.state === "present" && now.state === "absent") {
			changes.push({ file: was.file, change: "deleted" });
		} else if (was.digest !== now.digest) {
			changes.push({ file: was.file, change: "modified" });
		}
	}
	return changes;
}

/** PURE. Did anything happen that should stop the run? `unverifiable` does not — it is reported. */
export function isBreach(changes) {
	return changes.some((change) => change.change !== "unverifiable");
}

/** PURE. The message an operator reads, naming the file, the change, and what to do. */
export function formatWitnessReport(changes) {
	if (changes.length === 0) return "";
	const lines = changes.map((change) => `  ${change.change.toUpperCase()}  ${change.file}`);
	if (!isBreach(changes)) {
		return `sovereign tripwire: could not verify ${changes.length} watched file(s)\n${lines.join("\n")}\n`;
	}
	return (
		"\nSOVEREIGN TRIPWIRE — a test run changed the operator's live configuration.\n" +
		`${lines.join("\n")}\n` +
		"This is ISS-109 and ISS-121 happening again. The suites under scripts/ run outside the\n" +
		"vitest home containment, so nothing stopped the write; find the suite that did it and give\n" +
		"it a temp directory. Restore the file from a backup before trusting anything it now says.\n"
	);
}
