import assert from "node:assert/strict";
import { test } from "node:test";

import { compareAnswers, PROBE_COMMANDS, ran, unrunnable } from "./directory-independence.mjs";

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

test("a directory where the command did not run → unrunnable, never silently same", () => {
	const byDirectory = {
		repo: ran({ ok: true }),
		rcdc5: ran({ ok: true }),
		tmp: unrunnable("timeout after 15000ms"),
	};
	const result = compareAnswers(byDirectory, MUST_BE_IDENTICAL);
	assert.equal(result.verdict, "unrunnable");
	assert.deepEqual(result.unrunnableDirectories, ["tmp"]);
});

test("unrunnable takes priority even when every directory that DID run agrees", () => {
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
	assert.equal(result.verdict, "unrunnable");
	assert.notEqual(result.verdict, "same");
});

test("multiple unrunnable directories are all named", () => {
	const byDirectory = {
		repo: ran({ ok: true }),
		rcdc5: unrunnable("ENOENT: no such directory"),
		tmp: unrunnable("timeout after 15000ms"),
	};
	const result = compareAnswers(byDirectory, MUST_BE_IDENTICAL);
	assert.equal(result.verdict, "unrunnable");
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
