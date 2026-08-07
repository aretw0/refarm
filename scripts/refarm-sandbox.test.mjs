#!/usr/bin/env node
/**
 * Tests for `sandboxEnvironment` — the PURE core of scripts/refarm-sandbox.mjs.
 * `node --test scripts/refarm-sandbox.test.mjs`
 *
 * Driven entirely by literals (per the task-1 brief's interface note: "Test it with
 * literals") — no filesystem, no network, no process. The impure edge (finding an
 * actually-free port, spawning tractor) is exercised live in Task 1's Step 4, not here.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
	assertNoReservedFlags,
	RESERVED_FLAGS,
	SANDBOX_HTTP_PORT,
	SANDBOX_NAMESPACE,
	SANDBOX_PORT,
	sandboxEnvironment,
	startSandbox,
} from "./refarm-sandbox.mjs";

// A literal, not this checkout's real path — sandboxEnvironment must not assume anything
// about where it is actually run from.
const REPO_ROOT = "/repo";

test("declares all four axes, plus both ports — the whole recipe in one call", () => {
	const result = sandboxEnvironment(REPO_ROOT);

	assert.equal(result.env.SOVEREIGN_BASE, path.join(REPO_ROOT, ".sandbox"));
	assert.equal(result.env.SOVEREIGN_DIR, "refarm");
	assert.equal(result.env.REFARM_HOME, path.join(REPO_ROOT, ".sandbox", "refarm"));
	assert.equal(result.env.XDG_DATA_HOME, path.join(REPO_ROOT, ".sandbox", "share"));
	assert.equal(typeof result.port, "number");
	assert.equal(typeof result.httpPort, "number");
});

test("the graph axis is declared AT ALL — the defect this task was written with", () => {
	// The plan's first draft had three axes (SOVEREIGN_BASE, SOVEREIGN_DIR, REFARM_HOME —
	// the sovereign dir) and called it "everything". storage/sqlite.rs's db_dir() reads
	// XDG_DATA_HOME directly and does NOT follow REFARM_HOME (main.rs never passes REFARM_HOME
	// through to it) — a sandbox declared with only the sovereign trio opens the OPERATOR'S
	// real ~/.local/share/refarm/default.db, the one thing this plan promises never to touch.
	// This assertion is deliberately separate from the "all four axes" test above so a later
	// edit that drops this ONE key cannot hide behind an otherwise-passing shape check.
	const { env } = sandboxEnvironment(REPO_ROOT);
	assert.ok(
		Object.hasOwn(env, "XDG_DATA_HOME"),
		"sandboxEnvironment must declare XDG_DATA_HOME — the graph axis — or it has isolated nothing",
	);
	assert.ok(env.XDG_DATA_HOME, "XDG_DATA_HOME must not be empty/falsy");
});

test("the sovereign trio is mutually consistent: REFARM_HOME = SOVEREIGN_BASE + SOVEREIGN_DIR", () => {
	const { env } = sandboxEnvironment(REPO_ROOT);
	assert.equal(
		path.dirname(env.REFARM_HOME),
		env.SOVEREIGN_BASE,
		"dirname(REFARM_HOME) must equal SOVEREIGN_BASE, so declaredBase() (@refarm.dev/config) " +
			"resolves the same base the Rust host does",
	);
	assert.equal(
		path.basename(env.REFARM_HOME),
		env.SOVEREIGN_DIR,
		"basename(REFARM_HOME) must equal SOVEREIGN_DIR",
	);
});

test("XDG_DATA_HOME is inside the sandbox, but is NOT inside REFARM_HOME — a sibling, not a child", () => {
	const { env } = sandboxEnvironment(REPO_ROOT);
	assert.ok(
		env.XDG_DATA_HOME.startsWith(env.SOVEREIGN_BASE + path.sep),
		"XDG_DATA_HOME must live inside the sandbox base",
	);
	assert.ok(
		!env.XDG_DATA_HOME.startsWith(env.REFARM_HOME + path.sep) && env.XDG_DATA_HOME !== env.REFARM_HOME,
		"XDG_DATA_HOME must NOT be nested inside REFARM_HOME — asserted separately so a later " +
			"edit cannot quietly fold the graph back under the sovereign dir and still pass a " +
			'looser "somewhere under .sandbox" check',
	);
});

test("neither declared port collides with the operator's node (42000 ws / 42001 http)", () => {
	const { port, httpPort } = sandboxEnvironment(REPO_ROOT);
	assert.notEqual(port, 42000, "WS port must not be the operator's 42000");
	assert.notEqual(httpPort, 42001, "HTTP port must not be the operator's 42001");
	assert.notEqual(port, httpPort, "BOTH surfaces must be relocated — to two DIFFERENT ports, not one");
});

test("the exported port constants match what sandboxEnvironment defaults to", () => {
	const result = sandboxEnvironment(REPO_ROOT);
	assert.equal(result.port, SANDBOX_PORT);
	assert.equal(result.httpPort, SANDBOX_HTTP_PORT);
	assert.equal(result.namespace, SANDBOX_NAMESPACE);
});

test("namespace is declared and is not the operator's default", () => {
	const { namespace } = sandboxEnvironment(REPO_ROOT);
	assert.equal(typeof namespace, "string");
	assert.ok(namespace.length > 0);
	assert.notEqual(namespace, "default", 'must not collide with the operator\'s "default" namespace/db file');
});

test("port/httpPort/namespace overrides are honored — the impure edge supplies live-checked free ports", () => {
	const result = sandboxEnvironment(REPO_ROOT, { port: 50001, httpPort: 50002, namespace: "custom" });
	assert.equal(result.port, 50001);
	assert.equal(result.httpPort, 50002);
	assert.equal(result.namespace, "custom");
	// Overriding ports/namespace must never change the four axis declarations.
	assert.equal(result.env.SOVEREIGN_BASE, path.join(REPO_ROOT, ".sandbox"));
});

test("is pure: repeated calls with the same repoRoot return equal (deep) results", () => {
	const a = sandboxEnvironment(REPO_ROOT);
	const b = sandboxEnvironment(REPO_ROOT);
	assert.deepEqual(a, b);
});

// ---- assertNoReservedFlags — a caller's extraArgs must never be able to override the
// launcher's own safety-critical flags. clap takes the LAST occurrence of a scalar flag
// without erroring, and extraArgs is spread AFTER --refarm-dir/--port/--http-port/
// --namespace in startSandbox's argv — so a caller passing one of those through extraArgs
// (exactly the shape scripts/tractor-start.sh itself uses: fixed flags first, caller args
// appended last) would silently repoint the "sandbox" at the operator's real --refarm-dir,
// concurrently with his running node. Refuse instead of letting it win. ----

// Imported from the guard itself (not redeclared) — a fifth flag added to the source set
// grows this loop automatically instead of leaving a hand-copied list silently behind it.
for (const flag of RESERVED_FLAGS) {
	test(`assertNoReservedFlags refuses ${flag} (two-token form)`, () => {
		assert.throws(() => assertNoReservedFlags([flag, "some-value"]), new RegExp(`\\${flag}\\b`));
	});

	test(`assertNoReservedFlags refuses ${flag}=<value> (the = form)`, () => {
		assert.throws(() => assertNoReservedFlags([`${flag}=some-value`]), new RegExp(`\\${flag}\\b`));
	});
}

test("assertNoReservedFlags refuses a reserved flag anywhere in the list, not just first", () => {
	assert.throws(
		() => assertNoReservedFlags(["--plugin", "/some/plugin.wasm", "--refarm-dir", "/home/x/.refarm"]),
		/--refarm-dir/,
	);
});

test("assertNoReservedFlags allows flags it does not own, e.g. --plugin", () => {
	assert.doesNotThrow(() => assertNoReservedFlags(["--plugin", "/some/plugin.wasm"]));
});

test("assertNoReservedFlags allows an empty extraArgs", () => {
	assert.doesNotThrow(() => assertNoReservedFlags([]));
});

test("startSandbox rejects before doing any I/O when extraArgs names a reserved flag (two-token form)", async () => {
	// A caller passing the operator's real --refarm-dir must never reach the port-check or
	// spawn — this exercises startSandbox itself, not just the standalone guard, so a future
	// edit cannot forget to wire the guard in and still pass the unit test above.
	await assert.rejects(
		() => startSandbox({ repoRoot: REPO_ROOT, extraArgs: ["--refarm-dir", "/home/operator/.refarm"] }),
		/--refarm-dir/,
	);
});

test("startSandbox rejects the = form the same way", async () => {
	await assert.rejects(
		() => startSandbox({ repoRoot: REPO_ROOT, extraArgs: ["--port=9999"] }),
		/--port/,
	);
});
