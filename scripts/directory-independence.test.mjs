import assert from "node:assert/strict";
import { test } from "node:test";

import {
	compareAnswers,
	diffSnapshots,
	divergingPaths,
	judge,
	observedSovereignDir,
	PROBE_COMMANDS,
	ran,
	runProbe,
	summarise,
	unrunnable,
	validateDeclarations,
} from "./directory-independence.mjs";

/** A declaration with no allowed variance — the command must answer identically everywhere. */
const MUST_BE_IDENTICAL = { allowedVaryingFieldPaths: [] };

test("identical answers from every directory → same", () => {
	const byDirectory = {
		repo: ran({ ok: true, count: 3 }),
		rcdc5: ran({ ok: true, count: 3 }),
		tmp: ran({ ok: true, count: 3 }),
	};
	const result = compareAnswers(byDirectory, MUST_BE_IDENTICAL);
	assert.equal(result.verdict, "same");
	assert.deepEqual(result.fieldPaths, []);
});

test("a difference confined to a declared-varying field → differs-as-declared", () => {
	const declaration = { allowedVaryingFieldPaths: ["context.builtPluginPath", "context.builtPluginSha"] };
	const byDirectory = {
		repo: ran({
			context: { builtPluginPath: "/repo/agent.wasm", builtPluginSha: "abc123", mode: "node" },
		}),
		rcdc5: ran({
			context: { builtPluginPath: null, builtPluginSha: null, mode: "node" },
		}),
		tmp: ran({
			context: { builtPluginPath: null, builtPluginSha: null, mode: "node" },
		}),
	};
	const result = compareAnswers(byDirectory, declaration);
	assert.equal(result.verdict, "differs-as-declared");
	assert.deepEqual(result.fieldPaths.sort(), ["context.builtPluginPath", "context.builtPluginSha"]);
});

test("a difference in a field NOT declared as varying → differs-undeclared, naming the path", () => {
	const byDirectory = {
		repo: ran({
			connections: [{ name: "ovpn-serpro", state: "down" }],
			nextAction: "Connection 'ovpn-serpro' is down — bring it up",
		}),
		rcdc5: ran({
			connections: [{ name: "ovpn-serpro", state: "down" }],
			nextAction: "Connection 'ovpn-serpro' is down — bring it up",
		}),
		tmp: ran({
			connections: [],
			nextAction: null,
		}),
	};
	const result = compareAnswers(byDirectory, MUST_BE_IDENTICAL);
	assert.equal(result.verdict, "differs-undeclared");
	assert.deepEqual(result.fieldPaths.sort(), ["connections", "nextAction"]);
});

test("a declared-varying field diverging alongside an undeclared one → differs-undeclared names only the undeclared path", () => {
	const declaration = { allowedVaryingFieldPaths: ["context.builtPluginPath"] };
	const byDirectory = {
		repo: ran({ context: { builtPluginPath: "/repo/agent.wasm", mode: "node" } }),
		tmp: ran({ context: { builtPluginPath: null, mode: "detached" } }),
	};
	const result = compareAnswers(byDirectory, declaration);
	assert.equal(result.verdict, "differs-undeclared");
	assert.deepEqual(result.fieldPaths, ["context.mode"]);
});

test("a directory where the command did not run → unrunnable-somewhere, never silently same", () => {
	const byDirectory = {
		repo: ran({ ok: true }),
		rcdc5: ran({ ok: true }),
		tmp: unrunnable("timeout after 15000ms"),
	};
	const result = compareAnswers(byDirectory, MUST_BE_IDENTICAL);
	assert.equal(result.verdict, "unrunnable-somewhere");
	assert.deepEqual(result.unrunnableDirectories, ["tmp"]);
});

test("unrunnable-somewhere takes priority even when every directory that DID run agrees", () => {
	// The trap named in the brief: a command that crashes in /tmp produces no output, and
	// comparing two EMPTY results would read as agreement. Guard against that directly: even
	// when the two directories that ran are byte-for-byte identical, a third that never
	// produced an answer must not be reported as "same".
	const byDirectory = {
		repo: ran({ ok: true, count: 0 }),
		rcdc5: ran({ ok: true, count: 0 }),
		tmp: unrunnable("crashed: ENOENT"),
	};
	const result = compareAnswers(byDirectory, MUST_BE_IDENTICAL);
	assert.equal(result.verdict, "unrunnable-somewhere");
	assert.notEqual(result.verdict, "same");
});

test("multiple unrunnable directories are all named", () => {
	const byDirectory = {
		repo: ran({ ok: true }),
		rcdc5: unrunnable("ENOENT: no such directory"),
		tmp: unrunnable("timeout after 15000ms"),
	};
	const result = compareAnswers(byDirectory, MUST_BE_IDENTICAL);
	assert.equal(result.verdict, "unrunnable-somewhere");
	assert.deepEqual(result.unrunnableDirectories.sort(), ["rcdc5", "tmp"]);
});

test("a declared field path covers the whole subtree under it (array/object contents)", () => {
	const declaration = { allowedVaryingFieldPaths: ["context.otherSovereignDirs", "context.divergences"] };
	const byDirectory = {
		repo: ran({
			context: {
				otherSovereignDirs: ["/repo/.refarm"],
				divergences: [{ kind: "unloaded-sovereign-dir", summary: "repo has an unloaded .refarm" }],
			},
		}),
		tmp: ran({
			context: { otherSovereignDirs: [], divergences: [] },
		}),
	};
	const result = compareAnswers(byDirectory, declaration);
	assert.equal(result.verdict, "differs-as-declared");
});

test("declaring a whole command exempt would hide a real defect inside it — per-field only", () => {
	// A blanket per-command exemption is exactly what the design forbids. This pins that a
	// declaration naming ONE field does not accidentally swallow a sibling field's divergence.
	const declaration = { allowedVaryingFieldPaths: ["context.builtPluginPath"] };
	const byDirectory = {
		repo: ran({ context: { builtPluginPath: "/repo/agent.wasm", unrelatedRealDefect: "wrong-in-repo-only" } }),
		tmp: ran({ context: { builtPluginPath: null, unrelatedRealDefect: "wrong-elsewhere" } }),
	};
	const result = compareAnswers(byDirectory, declaration);
	assert.equal(result.verdict, "differs-undeclared");
	assert.deepEqual(result.fieldPaths, ["context.unrelatedRealDefect"]);
});

test("PROBE_COMMANDS declares the five known commands with the plan's known field paths", () => {
	const byName = Object.fromEntries(PROBE_COMMANDS.map((c) => [c.name, c]));
	assert.deepEqual(byName["workspace list"].allowedVaryingFieldPaths, []);
	assert.deepEqual(byName["model current"].allowedVaryingFieldPaths, []);
	assert.deepEqual(byName["plugin status"].allowedVaryingFieldPaths, []);
	assert.deepEqual(byName["connection status"].allowedVaryingFieldPaths, []);
	assert.ok(byName["context"].allowedVaryingFieldPaths.includes("context.builtPluginPath"));
	assert.ok(byName["context"].allowedVaryingFieldPaths.includes("context.builtPluginSha"));
});

// ---- The verdict observes; the scope judges. ----
//
// Everything above asserts what was OBSERVED across directories. Everything below asserts what that
// observation MEANS, which depends on what the command claims to speak about. Keeping the two in one
// field is what confined this probe to commands that must be identical: a command that reads THIS
// project's documents diverges by design, and a probe that could only say "differs" had to leave it
// out — which is how the surface reached 5 of 64 covered.

/** A node-scoped declaration with no allowed variance. */
const NODE_IDENTICAL = { scope: "node", scopeReason: "speaks for the node", allowedVaryingFieldPaths: [] };
/** A project-scoped declaration: expected to vary or refuse outside its own project. */
const PROJECT_SCOPED = { scope: "project", scopeReason: "reads this project", allowedVaryingFieldPaths: [] };

test("failing in ALL directories is unproven, not a conviction", () => {
	const byDirectory = {
		repo: unrunnable("CLI not built"),
		rcdc5: unrunnable("CLI not built"),
		tmp: unrunnable("CLI not built"),
	};
	const result = compareAnswers(byDirectory, NODE_IDENTICAL);
	assert.equal(result.verdict, "unproven");
	assert.equal(judge(result.verdict, "node"), "pass");
	assert.deepEqual(result.unrunnableDirectories.sort(), ["rcdc5", "repo", "tmp"]);
});

test("failing in SOME directories convicts a node command — the ENOENT shape", () => {
	const byDirectory = {
		repo: ran({ ok: true }),
		tmp: unrunnable("ENOENT /tmp/.project/handoff.json"),
		rcdc5: unrunnable("ENOENT /home/op/git/rcdc5/.project/handoff.json"),
	};
	const result = compareAnswers(byDirectory, NODE_IDENTICAL);
	assert.equal(result.verdict, "unrunnable-somewhere");
	assert.equal(judge(result.verdict, "node"), "convicted");
});

test("the SAME observation passes for a project-scoped command", () => {
	const byDirectory = {
		repo: ran({ ok: true }),
		tmp: unrunnable("ENOENT /tmp/.project/handoff.json"),
		rcdc5: unrunnable("ENOENT /home/op/git/rcdc5/.project/handoff.json"),
	};
	const result = compareAnswers(byDirectory, PROJECT_SCOPED);
	assert.equal(result.verdict, "unrunnable-somewhere");
	assert.equal(judge(result.verdict, "project"), "pass");
});

test("INVERSE CHECK: a project-scoped command answering identically everywhere is convicted", () => {
	// The quiet defect this whole split exists to catch: a command that reads THIS project's
	// documents, answering the same from /tmp, has stopped reading the project and is answering
	// from the node. `refarm parity` applies the same inverse rule to its ISOLATING_AXES table.
	const byDirectory = {
		repo: ran({ items: 3 }),
		tmp: ran({ items: 3 }),
		rcdc5: ran({ items: 3 }),
	};
	const result = compareAnswers(byDirectory, PROJECT_SCOPED);
	assert.equal(result.verdict, "same");
	assert.equal(judge(result.verdict, "project"), "convicted");
});

test("a node command differing on an undeclared path is convicted", () => {
	const byDirectory = {
		repo: ran({ base: "/home/op/github/refarm" }),
		tmp: ran({ base: "/tmp" }),
		rcdc5: ran({ base: "/home/op/git/rcdc5" }),
	};
	const result = compareAnswers(byDirectory, NODE_IDENTICAL);
	assert.equal(result.verdict, "differs-undeclared");
	assert.equal(judge(result.verdict, "node"), "convicted");
});

test("a project-scoped command differing on an undeclared path passes — variance is its job", () => {
	const byDirectory = { repo: ran({ items: 3 }), tmp: ran({ items: 0 }) };
	const result = compareAnswers(byDirectory, PROJECT_SCOPED);
	assert.equal(result.verdict, "differs-undeclared");
	assert.equal(judge(result.verdict, "project"), "pass");
});

test("a declared varying path with a reason passes and is counted apart from same", () => {
	const declaration = {
		scope: "node",
		scopeReason: "speaks for the node",
		allowedVaryingFieldPaths: ["ctx.builtPluginSha"],
		fieldReasons: { "ctx.builtPluginSha": "the built plugin is a fact about the working tree" },
	};
	const byDirectory = { repo: ran({ ctx: { builtPluginSha: "a" } }), tmp: ran({ ctx: { builtPluginSha: "b" } }) };
	const result = compareAnswers(byDirectory, declaration);
	assert.equal(result.verdict, "differs-as-declared");
	assert.equal(judge(result.verdict, "node"), "pass");
	assert.deepEqual(summarise([{ ...result, scope: "node" }]), {
		probed: 1,
		same: 0,
		declared: 1,
		convicted: 0,
		unproven: 0,
	});
});

test("summarise never folds declared or unproven into same", () => {
	const rows = [
		{ verdict: "same", scope: "node" },
		{ verdict: "same", scope: "node" },
		{ verdict: "differs-as-declared", scope: "node" },
		{ verdict: "differs-undeclared", scope: "node" },
		{ verdict: "unproven", scope: "node" },
		{ verdict: "same", scope: "project" },
	];
	assert.deepEqual(summarise(rows), { probed: 6, same: 2, declared: 1, convicted: 2, unproven: 1 });
});

test("validateDeclarations rejects a declared path with no reason", () => {
	const errors = validateDeclarations([
		{ name: "x", argv: ["x"], scope: "node", scopeReason: "r", allowedVaryingFieldPaths: ["a.b"] },
	]);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /a\.b/);
});

test("validateDeclarations rejects a command with no scope — there is no default", () => {
	const errors = validateDeclarations([{ name: "x", argv: ["x"], allowedVaryingFieldPaths: [] }]);
	assert.match(errors[0], /scope/);
});

test("validateDeclarations rejects a scope declared with no written reason", () => {
	const errors = validateDeclarations([
		{ name: "x", argv: ["x"], scope: "node", scopeReason: "   ", allowedVaryingFieldPaths: [] },
	]);
	assert.match(errors[0], /reason/);
});

test("every shipped PROBE_COMMANDS entry is well-formed", () => {
	assert.deepEqual(validateDeclarations(PROBE_COMMANDS), []);
});

// ---- Time-variance is not directory-variance. ----
//
// Measured 2026-08-10: four of the 36 probeable invocations differ between TWO RUNS IN THE SAME
// DIRECTORY — `resume` (environmentPressure.signals), `budget usage` (period.startMs/endMs),
// `project handoff validate` (ageMs), `inspect` (createdAt). The probe spawns each command once per
// directory, so those fields would diverge for reasons that have nothing to do with directories and
// four correct commands would be convicted. The control pair measures it instead of asking a human
// to declare it: a field that varies in place is UNMEASURABLE by this instrument, not exempt.

test("a field that varies IN PLACE is excluded from the comparison and reported", () => {
	const byDirectory = {
		repo: ran({ ageMs: 10, base: "/same" }),
		tmp: ran({ ageMs: 99, base: "/same" }),
	};
	const result = compareAnswers(byDirectory, NODE_IDENTICAL, ["ageMs"]);
	assert.equal(result.verdict, "same");
	assert.deepEqual(result.inPlaceFieldPaths, ["ageMs"]);
	assert.equal(judge(result.verdict, "node"), "pass");
});

test("an in-place varying field does NOT hide a real divergence beside it", () => {
	const byDirectory = {
		repo: ran({ ageMs: 10, base: "/repo" }),
		tmp: ran({ ageMs: 99, base: "/tmp" }),
	};
	const result = compareAnswers(byDirectory, NODE_IDENTICAL, ["ageMs"]);
	assert.equal(result.verdict, "differs-undeclared");
	assert.deepEqual(result.fieldPaths, ["base"]);
	assert.equal(judge(result.verdict, "node"), "convicted");
});

test("in-place exclusion is measured per field, never per command", () => {
	// The blanket-exemption trap, in its time-variance form: measuring that ONE field moves must
	// not buy silence for the rest of the answer.
	const byDirectory = { repo: ran({ t: 1, a: "x", b: "y" }), tmp: ran({ t: 2, a: "x", b: "z" }) };
	const result = compareAnswers(byDirectory, NODE_IDENTICAL, ["t"]);
	assert.deepEqual(result.fieldPaths, ["b"]);
});

test("divergingPaths is the one comparison both the control pair and the directories use", () => {
	assert.deepEqual(divergingPaths({ a: ran({ x: 1, y: 2 }), b: ran({ x: 1, y: 3 }) }), ["y"]);
	assert.deepEqual(divergingPaths({ a: ran({ x: 1 }), b: ran({ x: 1 }) }), []);
});

test("runProbe refuses a malformed declaration table rather than judging it as node", () => {
	// F3, and it was mine: validateDeclarations ran only inside main(), while this plan's own
	// burn-down step calls runProbe directly with a filtered table. A missing scope would have
	// fallen through judge()'s node branch and produced a verdict nobody declared.
	assert.throws(
		() => runProbe([{ name: "x", argv: ["x", "--json"], allowedVaryingFieldPaths: [] }], { repo: "/tmp" }),
		/scope/,
	);
});

// ---- The read-only rule is observed, not promised. ----
//
// `refarm task list --json` writes ~/.refarm/sessions/task-session.v1.json on every read (measured
// 2026-08-10 by bisecting a 72-invocation sweep). It is called `list`, it prints, it exits 0 — every
// angle that matters says read-only. That is exactly why the rule needs an observation behind it:
// a mutating entry in PROBE_COMMANDS writes to the operator's real node three times per run.

test("diffSnapshots names every file whose size or mtime moved", () => {
	const before = new Map([["/n/a", "1:10"], ["/n/b", "2:20"]]);
	const after = new Map([["/n/a", "1:10"], ["/n/b", "9:20"]]);
	assert.deepEqual(diffSnapshots(before, after), ["/n/b"]);
});

test("diffSnapshots reports an added and a removed file, not only a changed one", () => {
	const before = new Map([["/n/a", "1:10"], ["/n/gone", "1:1"]]);
	const after = new Map([["/n/a", "1:10"], ["/n/new", "1:1"]]);
	assert.deepEqual(diffSnapshots(before, after).sort(), ["/n/gone", "/n/new"]);
});

test("diffSnapshots is silent when nothing moved", () => {
	const same = new Map([["/n/a", "1:10"]]);
	assert.deepEqual(diffSnapshots(same, new Map(same)), []);
});

test("observedSovereignDir takes the home EXPLICITLY — no default to forget", () => {
	assert.equal(observedSovereignDir("/home/op"), "/home/op/.refarm");
	assert.equal(observedSovereignDir.length, 1);
});
