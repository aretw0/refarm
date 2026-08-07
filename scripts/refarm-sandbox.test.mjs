#!/usr/bin/env node
/**
 * Tests for `sandboxEnvironment` — the PURE core of scripts/refarm-sandbox.mjs.
 * `node --test scripts/refarm-sandbox.test.mjs`
 *
 * Driven entirely by literals (per the task-1 brief's interface note: "Test it with
 * literals") — no filesystem, no network, no process. The impure edge (finding an
 * actually-free port, spawning tractor) is exercised live in Task 1's Step 4, not here.
 *
 * Task 2 adds `copySandboxCredentials`, which DOES touch the filesystem — its tests use a
 * `node:fs.mkdtempSync` scratch directory as both a fake `~/.silo/identity.json` source and
 * a fake `<repo>/.sandbox`, with entirely SYNTHETIC token values (never anything from this
 * machine's real `~/.silo`). That lets the plan's Task 2 requirement — "verify the copies
 * are independent by checking that writing in the sandbox leaves the operator's file
 * unchanged" — be an automated, repeatable assertion instead of a one-time manual check.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
	assertNoReservedFlags,
	assertPathInsideSandboxRoot,
	classifySandboxLiveness,
	copySandboxCredentials,
	extraArgsSuppliesPlugin,
	forbiddenResetTargets,
	minimalCredentialTokens,
	OPERATOR_SILO_IDENTITY_PATH,
	parseSandboxPidFile,
	parseShellExports,
	PLUGIN_LOADING_FLAGS,
	pluginLoadersIn,
	resetSandbox,
	resolveDefaultPluginArgs,
	RESERVED_FLAGS,
	SANDBOX_HTTP_PORT,
	SANDBOX_LOG_FILE_NAME,
	SANDBOX_NAMESPACE,
	SANDBOX_PID_FILE_NAME,
	SANDBOX_PORT,
	sandboxAgentPluginPath,
	sandboxCmdlineMatches,
	sandboxEnvironment,
	sandboxStatus,
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

// ---- Task 2: credentials — the fifth declaration (SILO_HOME), NOT one of the four axes ----

test("sandboxEnvironment declares SILO_HOME, a sibling of REFARM_HOME/XDG_DATA_HOME", () => {
	const { env } = sandboxEnvironment(REPO_ROOT);
	assert.equal(env.SILO_HOME, path.join(REPO_ROOT, ".sandbox", "silo"));
	assert.notEqual(env.SILO_HOME, env.REFARM_HOME, "must not collide with the sovereign dir");
	assert.ok(
		!env.SILO_HOME.startsWith(env.REFARM_HOME + path.sep),
		"must not be nested inside REFARM_HOME — a sibling, like XDG_DATA_HOME",
	);
});

test("OPERATOR_SILO_IDENTITY_PATH points at ~/.silo/identity.json — the durable source, read-only", () => {
	assert.equal(OPERATOR_SILO_IDENTITY_PATH, path.join(os.homedir(), ".silo", "identity.json"));
});

// ---- sandboxAgentPluginPath — the recorded plugin decision ----

test("sandboxAgentPluginPath resolves to the working tree's freshly-built agent, not an installed copy", () => {
	assert.equal(
		sandboxAgentPluginPath(REPO_ROOT),
		path.join(REPO_ROOT, "packages", "agent", "dist", "agent.wasm"),
	);
});

// ---- minimalCredentialTokens — the "minimum set" contract, pinned by test rather than only
// documented. Every literal below is SYNTHETIC — none of it is a real credential. ----

test("minimalCredentialTokens keeps modelProvider, modelId, modelApiKey when present", () => {
	const result = minimalCredentialTokens({
		modelProvider: "openai",
		modelId: "gpt-5.6-sol",
		modelApiKey: "sk-test-fixture-not-real",
	});
	assert.equal(result.modelProvider, "openai");
	assert.equal(result.modelId, "gpt-5.6-sol");
	assert.equal(result.modelApiKey, "sk-test-fixture-not-real");
	assert.equal(result.oauthProvider, undefined);
});

// ---- Code review follow-up: the allowlist was missing members buildCurrentModelStatus
// (model.ts) and effectiveModelRouteForScope (model-routing.js) also read. One test per
// newly-included field, so a future trim can't silently drop one and still pass. ----

test("minimalCredentialTokens keeps the legacy `model` alias for modelId", () => {
	// effectiveModelRouteForScope (model-routing.js:260) falls back to tokens.model when
	// tokens.modelId is absent — dropping it would silently lose a route set through the
	// legacy field.
	const result = minimalCredentialTokens({ modelProvider: "openai", model: "gpt-5.6-sol" });
	assert.equal(result.model, "gpt-5.6-sol");
});

test("minimalCredentialTokens keeps modelBaseUrl — read by buildCurrentModelStatus (model.ts:915)", () => {
	const result = minimalCredentialTokens({
		modelProvider: "openai",
		modelBaseUrl: "https://fixture.example/v1",
	});
	assert.equal(result.modelBaseUrl, "https://fixture.example/v1");
});

test("minimalCredentialTokens keeps modelFallbackProvider/modelFallbackModelId (model.ts:917,922)", () => {
	const result = minimalCredentialTokens({
		modelProvider: "openai-codex",
		modelFallbackProvider: "anthropic",
		modelFallbackModelId: "claude-sonnet-5",
	});
	assert.equal(result.modelFallbackProvider, "anthropic");
	assert.equal(result.modelFallbackModelId, "claude-sonnet-5");
});

test("minimalCredentialTokens drops modelRoutes — excluded deliberately, not an oversight", () => {
	// buildModelEnvEntries never exports a worker/monitor-scoped env var (MODEL_RUNTIME_ENV_VARS
	// only carries the default scope), so a sandbox missing modelRoutes resolves the identical
	// env-var set a copy WITH it would. Only refarm model current's TEXT display of the
	// worker/monitor rows would differ — not anything this task's proof depends on.
	const result = minimalCredentialTokens({
		modelProvider: "openai-codex",
		modelRoutes: { worker: "openai-codex/gpt-5.3-codex-spark", monitor: "openai-codex/gpt-5.5" },
	});
	assert.equal(result.modelRoutes, undefined);
	assert.deepEqual(Object.keys(result), ["modelProvider"]);
});

test("minimalCredentialTokens keeps ONLY the active oauth provider's {access, accountId, expires}", () => {
	const result = minimalCredentialTokens({
		modelProvider: "openai-codex",
		modelId: "gpt-5.5",
		oauthProvider: "openai-codex",
		oauthCredentials: {
			"openai-codex": {
				access: "fixture-access-token",
				refresh: "fixture-refresh-token",
				expires: 1234567890,
				accountId: "fixture-account-id",
			},
			// A second, inactive provider entry — must NOT survive.
			anthropic: { access: "should-never-appear" },
		},
	});
	assert.deepEqual(result.oauthCredentials, {
		"openai-codex": {
			access: "fixture-access-token",
			accountId: "fixture-account-id",
			expires: 1234567890,
		},
	});
	assert.equal(result.oauthProvider, "openai-codex");
});

test("minimalCredentialTokens drops the refresh token — nothing in this repo calls refreshToken() today", () => {
	const result = minimalCredentialTokens({
		oauthProvider: "openai-codex",
		oauthCredentials: { "openai-codex": { access: "a", refresh: "must-not-survive" } },
	});
	assert.equal(result.oauthCredentials["openai-codex"].refresh, undefined);
	assert.ok(!("refresh" in result.oauthCredentials["openai-codex"]));
});

test("minimalCredentialTokens drops githubToken/githubOwner/cloudflareToken — unrelated to model routing", () => {
	const result = minimalCredentialTokens({
		modelProvider: "openai-codex",
		githubToken: "must-not-survive",
		githubOwner: "must-not-survive",
		cloudflareToken: "must-not-survive",
	});
	assert.deepEqual(Object.keys(result), ["modelProvider"]);
});

test("minimalCredentialTokens returns {} for empty input, and for an oauth entry missing access", () => {
	assert.deepEqual(minimalCredentialTokens({}), {});
	assert.deepEqual(minimalCredentialTokens(undefined), {});
	assert.deepEqual(
		minimalCredentialTokens({ oauthProvider: "openai-codex", oauthCredentials: { "openai-codex": {} } }),
		{},
	);
});

test("minimalCredentialTokens does not mutate its input", () => {
	const input = Object.freeze({
		modelProvider: "openai-codex",
		oauthProvider: "openai-codex",
		oauthCredentials: Object.freeze({ "openai-codex": Object.freeze({ access: "a" }) }),
	});
	assert.doesNotThrow(() => minimalCredentialTokens(input));
});

// ---- parseShellExports — the inverse of model.ts's shellQuote/formatModelEnvShell ----

test("parseShellExports parses simple export lines", () => {
	const entries = parseShellExports("export MODEL_PROVIDER='openai-codex'\nexport MODEL_ID='gpt-5.5'");
	assert.deepEqual(entries, { MODEL_PROVIDER: "openai-codex", MODEL_ID: "gpt-5.5" });
});

test("parseShellExports unescapes shellQuote's single-quote escaping", () => {
	// shellQuote(`it's a value=with=equals`) === `'it'\''s a value=with=equals'`
	const entries = parseShellExports(`export TOKEN='it'\\''s a value=with=equals'`);
	assert.equal(entries.TOKEN, "it's a value=with=equals");
});

test("parseShellExports ignores blank lines and non-export lines", () => {
	const entries = parseShellExports("\n# a comment\nexport A='1'\n\nnot an export\nexport B='2'\n");
	assert.deepEqual(entries, { A: "1", B: "2" });
});

test("parseShellExports round-trips values containing '='", () => {
	const entries = parseShellExports("export OPENAI_CODEX_ACCESS_TOKEN='header.payload=.sig'");
	assert.equal(entries.OPENAI_CODEX_ACCESS_TOKEN, "header.payload=.sig");
});

test("parseShellExports returns {} for empty input", () => {
	assert.deepEqual(parseShellExports(""), {});
});

// ---- Code review follow-up: refuse an unclosed single-quoted value (embedded raw newline)
// rather than silently truncating it. shellQuote() escapes ' but never \n. ----

test("parseShellExports THROWS rather than silently truncating a value containing a raw newline", () => {
	// shellQuote("line1\nline2") === "'line1\nline2'" — a literal newline INSIDE the quotes,
	// which this line-oriented parser would otherwise split into "export TOKEN='line1"
	// (looks complete if unterminated-detection is missing) and "line2'" (silently dropped
	// as "not an export line") — a truncated credential with no error.
	const maliciousExport = "export TOKEN='line1\nline2'";
	assert.throws(() => parseShellExports(maliciousExport), /TOKEN/);
});

test("parseShellExports THROWS naming the exact key whose value is unclosed, not a neighbor", () => {
	const text = "export GOOD='fine'\nexport BAD='unterminated\nexport ALSO_GOOD='fine2'";
	assert.throws(() => parseShellExports(text), /BAD/);
});

test("parseShellExports THROWS on trailing content after a quote that DID close", () => {
	assert.throws(() => parseShellExports("export KEY='closed' trailing-garbage"), /KEY/);
});

// ---- copySandboxCredentials — filesystem-scoped to a mkdtempSync sandbox, entirely
// synthetic content. Proves the plan's Task 2 independence requirement by test, not just
// by one-time manual observation. ----

function withTmpRepoRoot(fn) {
	const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sandbox-creds-"));
	try {
		return fn(repoRoot);
	} finally {
		fs.rmSync(repoRoot, { recursive: true, force: true });
	}
}

function writeFixtureSource(dir, tokens) {
	const sourcePath = path.join(dir, "fixture-identity.json");
	fs.writeFileSync(sourcePath, JSON.stringify({ schemaVersion: 1, tokens }, null, 2));
	return sourcePath;
}

const FIXTURE_TOKENS = {
	modelProvider: "openai-codex",
	modelId: "gpt-5.5",
	oauthProvider: "openai-codex",
	oauthCredentials: {
		"openai-codex": { access: "fixture-access", accountId: "fixture-account", expires: 1, refresh: "fixture-refresh" },
	},
	githubToken: "fixture-github-token",
	githubOwner: "fixture-owner",
	cloudflareToken: "fixture-cf-token",
};

test("copySandboxCredentials copies the minimum set into <repo>/.sandbox/silo/identity.json", () => {
	withTmpRepoRoot((repoRoot) => {
		const sourcePath = writeFixtureSource(repoRoot, FIXTURE_TOKENS);
		const result = copySandboxCredentials(repoRoot, { sourcePath });

		assert.equal(result.copied, true);
		assert.equal(result.destPath, path.join(repoRoot, ".sandbox", "silo", "identity.json"));
		assert.equal(result.provider, "openai-codex");
		assert.equal(result.hasOAuth, true);

		const written = JSON.parse(fs.readFileSync(result.destPath, "utf8"));
		assert.equal(written.tokens.modelProvider, "openai-codex");
		assert.equal(written.tokens.oauthCredentials["openai-codex"].access, "fixture-access");
		// The over-copy this task exists to avoid — must be ABSENT from the written file.
		assert.equal(written.tokens.githubToken, undefined);
		assert.equal(written.tokens.cloudflareToken, undefined);
		assert.equal(written.tokens.oauthCredentials["openai-codex"].refresh, undefined);
	});
});

test("copySandboxCredentials writes the destination file and directory with restrictive permissions", () => {
	withTmpRepoRoot((repoRoot) => {
		const sourcePath = writeFixtureSource(repoRoot, FIXTURE_TOKENS);
		const result = copySandboxCredentials(repoRoot, { sourcePath });

		const fileMode = fs.statSync(result.destPath).mode & 0o777;
		const dirMode = fs.statSync(path.dirname(result.destPath)).mode & 0o777;
		assert.equal(fileMode, 0o600, `expected file mode 600, got ${fileMode.toString(8)}`);
		assert.equal(dirMode, 0o700, `expected dir mode 700, got ${dirMode.toString(8)}`);
	});
});

test("copySandboxCredentials NEVER writes the source — writing the sandbox copy leaves it byte-identical", () => {
	withTmpRepoRoot((repoRoot) => {
		const sourcePath = writeFixtureSource(repoRoot, FIXTURE_TOKENS);
		const before = fs.readFileSync(sourcePath, "utf8");
		const beforeMtime = fs.statSync(sourcePath).mtimeMs;

		copySandboxCredentials(repoRoot, { sourcePath });
		// Copy again — a second sync must still never touch the source.
		copySandboxCredentials(repoRoot, { sourcePath });

		const after = fs.readFileSync(sourcePath, "utf8");
		assert.equal(after, before, "source content must be byte-identical after the sandbox copy exists");
		assert.equal(fs.statSync(sourcePath).mtimeMs, beforeMtime, "source must not even be touched/rewritten");
	});
});

test("copySandboxCredentials refuses gracefully (never throws) when the source does not exist", () => {
	withTmpRepoRoot((repoRoot) => {
		const missingSource = path.join(repoRoot, "does-not-exist.json");
		const result = copySandboxCredentials(repoRoot, { sourcePath: missingSource });
		assert.equal(result.copied, false);
		assert.match(result.reason, /no credential source/);
		assert.equal(fs.existsSync(result.destPath), false);
	});
});

test("copySandboxCredentials refuses gracefully when the source is not valid JSON", () => {
	withTmpRepoRoot((repoRoot) => {
		const sourcePath = path.join(repoRoot, "broken.json");
		fs.writeFileSync(sourcePath, "{ not json");
		const result = copySandboxCredentials(repoRoot, { sourcePath });
		assert.equal(result.copied, false);
		assert.match(result.reason, /not valid JSON/);
	});
});

test("copySandboxCredentials refuses gracefully when the source names no usable credential", () => {
	withTmpRepoRoot((repoRoot) => {
		const sourcePath = writeFixtureSource(repoRoot, { githubToken: "irrelevant-to-model-routing" });
		const result = copySandboxCredentials(repoRoot, { sourcePath });
		assert.equal(result.copied, false);
		assert.match(result.reason, /no usable credential/);
	});
});

test("copySandboxCredentials re-syncs (overwrites) an existing destination rather than merging stale content", () => {
	withTmpRepoRoot((repoRoot) => {
		const sourcePath = writeFixtureSource(repoRoot, FIXTURE_TOKENS);
		copySandboxCredentials(repoRoot, { sourcePath });

		// Simulate a token rotation on the operator's side.
		fs.writeFileSync(
			sourcePath,
			JSON.stringify({
				schemaVersion: 1,
				tokens: {
					...FIXTURE_TOKENS,
					oauthCredentials: { "openai-codex": { access: "rotated-access", accountId: "fixture-account" } },
				},
			}),
		);
		const result = copySandboxCredentials(repoRoot, { sourcePath });
		const written = JSON.parse(fs.readFileSync(result.destPath, "utf8"));
		assert.equal(written.tokens.oauthCredentials["openai-codex"].access, "rotated-access");
	});
});

// ---- Code review follow-up: every flag in PLUGIN_LOADING_FLAGS is a repeatable Vec on the
// Rust side, so clap APPENDS every occurrence — it does NOT let a later one win over an
// earlier one, the way the four RESERVED_FLAGS (all scalar) do. Appending the default AND a
// caller-supplied plugin loader would load BOTH, not let the caller's override.
//
// A second review found --plugin-by-hash was missing from the FIRST version of this guard
// entirely (recognized only "--plugin", nothing else) — reopening the exact defect just
// fixed, wearing a different flag.
//
// WHAT IS GENERATED, and what is not — stated precisely because a third review found the
// first version of this loop overstated its own coverage (recognition was generated;
// REPORTING CONTENT was not — a `.length === 1` check would pass even if a future flag's
// `describeValue` were silently ignored or mislabeled). The loop below, driven by
// `Object.keys(PLUGIN_LOADING_FLAGS)`, now generates for EVERY member: recognition (both
// argv forms), the skip-default decision, AND a check that `pluginLoadersIn` routes that
// flag's value through THAT flag's OWN `describeValue` (both argv forms) — so a future
// flag added to the set that `pluginLoadersIn` dispatches to the WRONG descriptor, or
// doesn't dispatch at all, fails here automatically, with no test to remember to write.
//
// What remains, unavoidably, human-authored: the CONTENT of a brand-new flag's own
// `describeValue` function. The generated check above computes its expected value by
// calling that SAME function, so it proves dispatch/wiring, not semantics — a typo inside
// a NEW flag's own `describeValue` (e.g. tagging the wrong label, or truncating the value)
// calls the identical buggy function on both sides of the assertion and would not be
// caught by the generated loop. Only a literal, hand-written expected string catches that,
// same as any other "does this specific transformation do what I meant" check always
// requires a human who knows what was meant. The explicit tests further below pin exactly
// that for TODAY's two members (`--plugin`'s bare-path passthrough, `--plugin-by-hash`'s
// `[by-hash] ` tag) — adding a third flag means adding one matching literal test for IT,
// same discipline as writing the flag's `describeValue` in the first place, not zero
// discipline. ----

for (const flag of Object.keys(PLUGIN_LOADING_FLAGS)) {
	const descriptor = PLUGIN_LOADING_FLAGS[flag];

	test(`extraArgsSuppliesPlugin recognizes ${flag} (two-token form)`, () => {
		assert.equal(extraArgsSuppliesPlugin([flag, "some-value"]), true);
	});

	test(`extraArgsSuppliesPlugin recognizes ${flag}=<value> (the = form)`, () => {
		assert.equal(extraArgsSuppliesPlugin([`${flag}=some-value`]), true);
	});

	test(`resolveDefaultPluginArgs skips the default when the caller supplies ${flag}`, () => {
		const result = resolveDefaultPluginArgs("/repo/packages/agent/dist/agent.wasm", [flag, "some-value"], {
			existsSync: () => true,
		});
		assert.deepEqual(result.pluginArgs, []);
		assert.equal(result.notice, undefined);
	});

	// WIRING, not semantics — see the block comment above for exactly what this does and
	// does not prove. Covers both argv forms so neither is only proven for today's members.
	test(`pluginLoadersIn routes ${flag}'s value through its OWN describeValue (two-token form)`, () => {
		assert.deepEqual(pluginLoadersIn([flag, "some-value"]), [descriptor.describeValue("some-value")]);
	});

	test(`pluginLoadersIn routes ${flag}'s value through its OWN describeValue (the = form)`, () => {
		assert.deepEqual(pluginLoadersIn([`${flag}=some-value`]), [descriptor.describeValue("some-value")]);
	});
}

test("extraArgsSuppliesPlugin is false when the caller names no plugin-loading flag at all", () => {
	assert.equal(extraArgsSuppliesPlugin([]), false);
	assert.equal(extraArgsSuppliesPlugin(["--refarm-dir", "/x"]), false);
});

test("pluginLoadersIn returns [] when no plugin-loading flag is present", () => {
	assert.deepEqual(pluginLoadersIn(["--port", "43000"]), []);
});

test("pluginLoadersIn ignores a trailing plugin-loading flag with no value rather than throwing", () => {
	assert.deepEqual(pluginLoadersIn(["--port", "43000", "--plugin"]), []);
});

test("pluginLoadersIn reads every occurrence across BOTH forms, in order", () => {
	const args = ["--port", "43000", "--plugin", "/a.wasm", "--namespace", "sandbox", "--plugin=/b.wasm"];
	assert.deepEqual(pluginLoadersIn(args), ["/a.wasm", "/b.wasm"]);
});

test("pluginLoadersIn reports --plugin's value as the bare path, unchanged", () => {
	assert.deepEqual(pluginLoadersIn(["--plugin", "/a.wasm"]), ["/a.wasm"]);
});

test("pluginLoadersIn reports --plugin-by-hash's value TAGGED as by-hash, never as if it were a plain path", () => {
	// <assetsDir>:<hash>:<manifestPath> is not a path — reporting it bare would be its own
	// small lie about what was loaded.
	const spec = "/assets:deadbeef:/manifest.json";
	assert.deepEqual(pluginLoadersIn(["--plugin-by-hash", spec]), [`[by-hash] ${spec}`]);
	assert.deepEqual(pluginLoadersIn([`--plugin-by-hash=${spec}`]), [`[by-hash] ${spec}`]);
});

test("pluginLoadersIn reports BOTH loader kinds together, each in its own form", () => {
	const args = ["--plugin", "/a.wasm", "--plugin-by-hash", "/assets:h:m.json"];
	assert.deepEqual(pluginLoadersIn(args), ["/a.wasm", "[by-hash] /assets:h:m.json"]);
});

// resolveDefaultPluginArgs is the EXACT function startSandbox calls (not a re-implementation
// tests exercise standalone while startSandbox does something subtly different) — its
// `existsSync` is injectable so these tests never touch the real filesystem.

test("resolveDefaultPluginArgs: no caller plugin loader and the default file exists → appends the default", () => {
	const result = resolveDefaultPluginArgs("/repo/packages/agent/dist/agent.wasm", [], { existsSync: () => true });
	assert.deepEqual(result.pluginArgs, ["--plugin", "/repo/packages/agent/dist/agent.wasm"]);
	assert.equal(result.notice, undefined);
});

test("resolveDefaultPluginArgs: no caller plugin loader and the default file is MISSING → no args, a notice instead", () => {
	const result = resolveDefaultPluginArgs("/repo/packages/agent/dist/agent.wasm", [], { existsSync: () => false });
	assert.deepEqual(result.pluginArgs, []);
	assert.match(result.notice, /agent plugin not found/);
});

test("resolveDefaultPluginArgs: plugin: null means no default, regardless of extraArgs", () => {
	const result = resolveDefaultPluginArgs(null, [], { existsSync: () => true });
	assert.deepEqual(result.pluginArgs, []);
	assert.equal(result.notice, undefined);
});

test("startSandbox produces exactly ONE loaded plugin end-to-end when the caller supplies --plugin, never the default too", async () => {
	// Assembles the SAME args shape startSandbox builds (fixed flags, then
	// resolveDefaultPluginArgs's output, then extraArgs) and confirms pluginLoadersIn — the
	// function startSandbox itself uses to compute the `plugins` it returns/prints — sees
	// only the caller's path. This chains the two real, exported pieces together
	// (resolveDefaultPluginArgs → pluginLoadersIn) rather than re-asserting each in
	// isolation, so a future edit that reconnects them differently cannot pass by
	// accident. The live daemon-spawn edge itself is proven in task-2-report.md via
	// /proc/<pid>/cmdline against a real running sandbox, per this file's existing
	// convention of keeping that edge out of node:test (see the file header).
	const defaultPlugin = "/repo/packages/agent/dist/agent.wasm";
	const extraArgs = ["--plugin", "/caller-chosen.wasm"];
	const { pluginArgs } = resolveDefaultPluginArgs(defaultPlugin, extraArgs, { existsSync: () => true });
	const finalArgs = ["--port", "43000", "--refarm-dir", "/r", ...pluginArgs, ...extraArgs];
	assert.deepEqual(pluginLoadersIn(finalArgs), ["/caller-chosen.wasm"]);
});

test("startSandbox produces exactly ONE loaded plugin end-to-end when the caller supplies --plugin-by-hash — the finding that reopened this", async () => {
	// The precise scenario the second review described: a caller means --plugin-by-hash to
	// be their ONLY plugin. Must not ALSO get the default --plugin agent.wasm.
	const defaultPlugin = "/repo/packages/agent/dist/agent.wasm";
	const extraArgs = ["--plugin-by-hash", "/assets:deadbeef:/manifest.json"];
	const { pluginArgs } = resolveDefaultPluginArgs(defaultPlugin, extraArgs, { existsSync: () => true });
	const finalArgs = ["--port", "43000", "--refarm-dir", "/r", ...pluginArgs, ...extraArgs];
	assert.deepEqual(pluginLoadersIn(finalArgs), ["[by-hash] /assets:deadbeef:/manifest.json"]);
});

// =====================================================================================
// Task 3: `status` and `--reset`
//
// "status answers which sandbox exists and whether its node is running" — TWO different
// questions (disk state, and liveness), and liveness itself is THREE states, never two:
// a stale pid file after a crash/reboot is the ORDINARY case (not an error), and a pid can
// be reused by an unrelated process — so "a process with this pid exists" is not the same
// question as "this sandbox's tractor process is running". Collapsing either pair into one
// boolean is the exact shape this line of work has hit fourteen times before.
//
// "--reset deletes the sandbox and NOTHING else" — bounded so it is IMPOSSIBLE (not just
// unlikely) to reach anything outside <repo>/.sandbox: a `..`-laden path, a symlink whose
// target is elsewhere, a sibling that merely SHARES A STRING PREFIX (`.sandboxes/` against
// `.sandbox`), and a relative path resolved against the wrong cwd are each tested below as
// their own scenario, not folded into one generic "is it safe" assertion.
// =====================================================================================

// ---- parseSandboxPidFile — PURE. What does the pid FILE ITSELF say, before any liveness
// probe runs at all? Three admissible outcomes for the READ, and two of its own three
// possible verdicts (the third, "found a plausible pid, go probe it", is not a verdict —
// it is a signal to keep going, returned as a bare `{ pid }` with no `state`). ----

test("parseSandboxPidFile: no pid file at all → confidently not-running (never started, or cleaned up)", () => {
	const result = parseSandboxPidFile({ kind: "missing" });
	assert.equal(result.state, "not-running");
	assert.equal(result.pid, null);
	assert.match(result.detail, /no pid file/i);
});

test("parseSandboxPidFile: pid file exists but could not be read → unknown, never guessed as either", () => {
	const result = parseSandboxPidFile({ kind: "unreadable", reason: "EACCES: permission denied" });
	assert.equal(result.state, "unknown");
	assert.equal(result.pid, null);
	assert.match(result.detail, /could not be read/);
	assert.match(result.detail, /EACCES/, "the underlying reason must be surfaced, not swallowed");
});

for (const malformed of ["", "not-a-pid", "-5", "0", "3.5", "12abc"]) {
	test(`parseSandboxPidFile: malformed content ${JSON.stringify(malformed)} → unknown, not a guessed pid`, () => {
		const result = parseSandboxPidFile({ kind: "text", value: malformed });
		assert.equal(result.state, "unknown");
		assert.equal(result.pid, null);
	});
}

test("parseSandboxPidFile: a valid pid (with surrounding whitespace/newline, as fs.writeFileSync(pidFile, String(pid)) plus a shell echo might produce) → no state yet, just the pid to probe", () => {
	const result = parseSandboxPidFile({ kind: "text", value: "  12345\n" });
	assert.deepEqual(result, { pid: 12345 });
});

// ---- Code review follow-up (Minor, "the same shape as the Critical"): a THIRD branch was
// checked ("missing", "unreadable") and everything else was ASSUMED to be `{kind:"text",
// value}` — an unrecognized `read.kind` would have thrown a bare TypeError from
// `.trim()` rather than degrading to "unknown" like every other unrecognized input in this
// function. Unreachable today (no real caller constructs a fourth shape), but made explicit
// rather than assumed. ----

test("parseSandboxPidFile: an unrecognized read.kind → unknown, not a thrown TypeError", () => {
	assert.doesNotThrow(() => parseSandboxPidFile({ kind: "bogus" }));
	const result = parseSandboxPidFile({ kind: "bogus" });
	assert.equal(result.state, "unknown");
	assert.equal(result.pid, null);
	assert.match(result.detail, /unrecognized read kind/);
});

// ---- sandboxCmdlineMatches — PURE. The identity check that makes RUNNING mean "this
// sandbox's tractor, confirmed", not "a process with this pid happens to be alive". A pid
// can be reused by ANY unrelated process — including the OPERATOR'S OWN tractor node, whose
// --refarm-dir is a real, specific, different path, not a hypothetical. ----

test("sandboxCmdlineMatches: true for the bare 'tractor' binary name with a matching --refarm-dir", () => {
	assert.equal(
		sandboxCmdlineMatches(["tractor", "--port", "43000", "--refarm-dir", "/repo/.sandbox/refarm"], {
			refarmHome: "/repo/.sandbox/refarm",
		}),
		true,
	);
});

test("sandboxCmdlineMatches: true for a full binary path ending in /tractor", () => {
	assert.equal(
		sandboxCmdlineMatches(["/repo/.cache/cargo-target/release/tractor", "--refarm-dir", "/repo/.sandbox/refarm"], {
			refarmHome: "/repo/.sandbox/refarm",
		}),
		true,
	);
});

test("sandboxCmdlineMatches: false when the binary is not tractor at all", () => {
	assert.equal(
		sandboxCmdlineMatches(["/usr/bin/some-other-app", "--refarm-dir", "/repo/.sandbox/refarm"], {
			refarmHome: "/repo/.sandbox/refarm",
		}),
		false,
	);
});

test("sandboxCmdlineMatches: false when it IS a tractor process but --refarm-dir names a DIFFERENT dir — the operator's own node reusing this pid must never be reported as the sandbox", () => {
	assert.equal(
		sandboxCmdlineMatches(["tractor", "--refarm-dir", "/home/operator/.refarm"], {
			refarmHome: "/repo/.sandbox/refarm",
		}),
		false,
	);
});

test("sandboxCmdlineMatches: false when --refarm-dir is absent entirely", () => {
	assert.equal(sandboxCmdlineMatches(["tractor", "--port", "43000"], { refarmHome: "/repo/.sandbox/refarm" }), false);
});

test("sandboxCmdlineMatches: false for an empty or non-array cmdline", () => {
	assert.equal(sandboxCmdlineMatches([], { refarmHome: "/repo/.sandbox/refarm" }), false);
	assert.equal(sandboxCmdlineMatches(null, { refarmHome: "/repo/.sandbox/refarm" }), false);
});

// ---- classifySandboxLiveness — PURE. Combines an already-parsed pid result with the raw
// liveness-probe outcome into exactly one of THREE states. Every branch is driven by
// literals, per this file's own convention (see header). ----

test("classifySandboxLiveness: an already-resolved parsedPid (missing/malformed pid file) short-circuits — the probe/cmdline inputs are never consulted", () => {
	const resolved = { pid: null, state: "unknown", detail: "pid file content is not a valid pid" };
	const result = classifySandboxLiveness(resolved, {
		killOutcome: "alive",
		cmdlineArgs: ["tractor"],
		refarmHome: "/repo/.sandbox/refarm",
	});
	assert.deepEqual(result, resolved);
});

test("classifySandboxLiveness: killOutcome 'dead' → not-running — the ordinary stale-pid-file case, not an error", () => {
	const result = classifySandboxLiveness(
		{ pid: 99999 },
		{ killOutcome: "dead", cmdlineArgs: null, refarmHome: "/repo/.sandbox/refarm" },
	);
	assert.equal(result.state, "not-running");
	assert.equal(result.pid, 99999);
	assert.match(result.detail, /stale/i);
});

test("classifySandboxLiveness: killOutcome 'unknown' (the probe itself was inconclusive) → unknown, never defaulted to either", () => {
	const result = classifySandboxLiveness(
		{ pid: 99999 },
		{ killOutcome: "unknown", cmdlineArgs: null, refarmHome: "/repo/.sandbox/refarm" },
	);
	assert.equal(result.state, "unknown");
});

test("classifySandboxLiveness: killOutcome 'alive' but cmdline could not be read → unknown, NOT running — identity was never confirmed", () => {
	const result = classifySandboxLiveness(
		{ pid: 99999 },
		{ killOutcome: "alive", cmdlineArgs: null, refarmHome: "/repo/.sandbox/refarm" },
	);
	assert.equal(result.state, "unknown");
	assert.match(result.detail, /identity/);
});

test("classifySandboxLiveness: killOutcome 'alive' but cmdline belongs to a DIFFERENT process → not-running, the pid-reuse case named in the brief", () => {
	const result = classifySandboxLiveness(
		{ pid: 99999 },
		{ killOutcome: "alive", cmdlineArgs: ["/usr/bin/firefox"], refarmHome: "/repo/.sandbox/refarm" },
	);
	assert.equal(result.state, "not-running");
	assert.match(result.detail, /different process|reused/i);
});

test("classifySandboxLiveness: killOutcome 'alive' with a matching cmdline → running, the only path that produces it", () => {
	const result = classifySandboxLiveness(
		{ pid: 99999 },
		{
			killOutcome: "alive",
			cmdlineArgs: ["tractor", "--refarm-dir", "/repo/.sandbox/refarm"],
			refarmHome: "/repo/.sandbox/refarm",
		},
	);
	assert.deepEqual(result, { pid: 99999, state: "running", detail: result.detail });
	assert.match(result.detail, /confirmed/);
});

// ---- sandboxStatus — the impure edge. Filesystem-scoped to mkdtempSync fixtures; the
// liveness probe/cmdline reader are injected so every one of the three states is exercised
// deterministically, without touching a real process. ----

function withStatusFixture(fn) {
	const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sandbox-status-"));
	try {
		return fn(repoRoot);
	} finally {
		fs.rmSync(repoRoot, { recursive: true, force: true });
	}
}

test("sandboxStatus: nothing on disk at all → every path reports exists:false, node is not-running", () => {
	withStatusFixture((repoRoot) => {
		const result = sandboxStatus(repoRoot);
		assert.equal(result.exists, false);
		assert.equal(result.refarmHome.exists, false);
		assert.equal(result.graphDir.exists, false);
		assert.equal(result.credential.exists, false);
		assert.equal(result.node.state, "not-running");
		assert.equal(result.node.pid, null);
	});
}
);

test("sandboxStatus: reports disk existence for each axis independently once created", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.REFARM_HOME, { recursive: true });
		fs.mkdirSync(env.XDG_DATA_HOME, { recursive: true });

		const result = sandboxStatus(repoRoot);
		assert.equal(result.exists, true);
		assert.equal(result.refarmHome.exists, true);
		assert.equal(result.graphDir.exists, true);
		// Nothing wrote silo/identity.json — must still be false, not inferred from the siblings.
		assert.equal(result.credential.exists, false);
	});
});

test("sandboxStatus: credential reports presence + octal mode, NEVER contents — even when the fixture holds a synthetic 'secret'", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SILO_HOME, { recursive: true, mode: 0o700 });
		const identityPath = path.join(env.SILO_HOME, "identity.json");
		const secretMarker = "SECRET-MARKER-MUST-NEVER-LEAK-abc123";
		fs.writeFileSync(identityPath, JSON.stringify({ tokens: { modelApiKey: secretMarker } }), { mode: 0o600 });

		const result = sandboxStatus(repoRoot);
		assert.equal(result.credential.exists, true);
		assert.equal(result.credential.mode, "600");
		const serialized = JSON.stringify(result);
		assert.ok(!serialized.includes(secretMarker), "sandboxStatus's own return value must never carry credential content");
	});
});

// ---- Code review follow-up (Important): two conversion branches inside sandboxStatus had no
// test exercising the ACTUAL conversion — only parseSandboxPidFile's own literal-driven tests
// proved the "unreadable" shape behaves correctly, and nothing proved sandboxStatus itself
// ever PRODUCES that shape from a real read failure, or that the credential statSync failure
// path actually reaches the `mode: null` branch rather than throwing. ----

test("sandboxStatus: the pid file exists but reading it throws → node state unknown, the underlying reason surfaced — proves sandboxStatus itself performs the {kind:'unreadable'} conversion, not just parseSandboxPidFile in isolation", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SOVEREIGN_BASE, { recursive: true });
		fs.writeFileSync(path.join(env.SOVEREIGN_BASE, SANDBOX_PID_FILE_NAME), "424242");

		const result = sandboxStatus(repoRoot, {
			readFileSync: () => {
				throw new Error("EACCES: permission denied, fixture-read");
			},
		});
		assert.equal(result.node.state, "unknown");
		assert.equal(result.node.pid, null);
		assert.match(result.node.detail, /could not be read/);
		assert.match(result.node.detail, /EACCES/, "the underlying reason must be surfaced, not swallowed");
	});
});

test("sandboxStatus: the credential file exists but statSync throws → mode:null with the reason surfaced, not a crash — proves the actual conversion, not just the documented contract", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SILO_HOME, { recursive: true, mode: 0o700 });
		fs.writeFileSync(path.join(env.SILO_HOME, "identity.json"), "{}", { mode: 0o600 });

		const result = sandboxStatus(repoRoot, {
			statSync: () => {
				throw new Error("EACCES: permission denied, fixture-stat");
			},
		});
		assert.equal(result.credential.exists, true);
		assert.equal(result.credential.mode, null);
		assert.match(result.credential.reason, /could not stat/);
		assert.match(result.credential.reason, /EACCES/);
	});
});

test("sandboxStatus: RUNNING — pid alive, cmdline confirmed as this sandbox's own tractor", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SOVEREIGN_BASE, { recursive: true });
		fs.writeFileSync(path.join(env.SOVEREIGN_BASE, SANDBOX_PID_FILE_NAME), "424242");

		const result = sandboxStatus(repoRoot, {
			probeLiveness: (pid) => (pid === 424242 ? "alive" : "unknown"),
			readCmdline: () => ["tractor", "--refarm-dir", env.REFARM_HOME],
		});
		assert.equal(result.node.state, "running");
		assert.equal(result.node.pid, 424242);
	});
});

test("sandboxStatus: NOT RUNNING — stale pid file, the ordinary case after a crash/reboot", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SOVEREIGN_BASE, { recursive: true });
		fs.writeFileSync(path.join(env.SOVEREIGN_BASE, SANDBOX_PID_FILE_NAME), "424242");

		const result = sandboxStatus(repoRoot, {
			probeLiveness: () => "dead",
			readCmdline: () => {
				throw new Error("must not be called when the probe already says dead");
			},
		});
		assert.equal(result.node.state, "not-running");
		assert.equal(result.node.pid, 424242);
	});
});

test("sandboxStatus: NOT RUNNING — the pid is alive but belongs to an unrelated process (pid reuse)", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SOVEREIGN_BASE, { recursive: true });
		fs.writeFileSync(path.join(env.SOVEREIGN_BASE, SANDBOX_PID_FILE_NAME), "424242");

		const result = sandboxStatus(repoRoot, {
			probeLiveness: () => "alive",
			readCmdline: () => ["/usr/bin/unrelated-process"],
		});
		assert.equal(result.node.state, "not-running");
		assert.match(result.node.detail, /different process|reused/i);
	});
});

test("sandboxStatus: UNKNOWN — pid alive but identity could not be confirmed (cmdline unreadable)", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SOVEREIGN_BASE, { recursive: true });
		fs.writeFileSync(path.join(env.SOVEREIGN_BASE, SANDBOX_PID_FILE_NAME), "424242");

		const result = sandboxStatus(repoRoot, {
			probeLiveness: () => "alive",
			readCmdline: () => null,
		});
		assert.equal(result.node.state, "unknown");
	});
});

test("sandboxStatus: UNKNOWN — the liveness probe itself was inconclusive", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SOVEREIGN_BASE, { recursive: true });
		fs.writeFileSync(path.join(env.SOVEREIGN_BASE, SANDBOX_PID_FILE_NAME), "424242");

		const result = sandboxStatus(repoRoot, { probeLiveness: () => "unknown" });
		assert.equal(result.node.state, "unknown");
	});
});

test("sandboxStatus: UNKNOWN — malformed pid file content, and the probe is never even invoked (short-circuit proven, not just claimed)", () => {
	withStatusFixture((repoRoot) => {
		const { env } = sandboxEnvironment(repoRoot);
		fs.mkdirSync(env.SOVEREIGN_BASE, { recursive: true });
		fs.writeFileSync(path.join(env.SOVEREIGN_BASE, SANDBOX_PID_FILE_NAME), "not-a-pid");

		let probeCalls = 0;
		const result = sandboxStatus(repoRoot, {
			probeLiveness: () => {
				probeCalls += 1;
				return "alive";
			},
		});
		assert.equal(result.node.state, "unknown");
		assert.equal(probeCalls, 0, "a malformed pid file must never reach the liveness probe");
	});
});

// ---- assertPathInsideSandboxRoot — PURE. The guard `resetSandbox` calls before it will ever
// consider a path a valid deletion target. Pinned directly and adversarially, independent of
// whether resetSandbox's own normal call path could produce these inputs (the same
// defense-in-depth discipline assertNoReservedFlags already established in this file). ----

test("assertPathInsideSandboxRoot: the sandbox root itself is always a valid target", () => {
	assert.doesNotThrow(() => assertPathInsideSandboxRoot("/repo/.sandbox", "/repo/.sandbox"));
});

test("assertPathInsideSandboxRoot: a path nested inside the sandbox root is valid", () => {
	assert.doesNotThrow(() => assertPathInsideSandboxRoot("/repo/.sandbox/refarm/node.json", "/repo/.sandbox"));
});

test("assertPathInsideSandboxRoot: refuses a sibling that merely SHARES A STRING PREFIX (.sandboxes vs .sandbox) — the naive startsWith() trap", () => {
	assert.throws(
		() => assertPathInsideSandboxRoot("/repo/.sandboxes/evil", "/repo/.sandbox"),
		/not inside the sandbox root/,
	);
});

test("assertPathInsideSandboxRoot: refuses a path that walks outside via .. segments", () => {
	assert.throws(
		() => assertPathInsideSandboxRoot("/repo/.sandbox/../../etc/passwd", "/repo/.sandbox"),
		/not inside the sandbox root/,
	);
});

test("assertPathInsideSandboxRoot: refuses a relative candidate that resolves outside sandboxRoot from the current cwd", () => {
	assert.throws(
		() => assertPathInsideSandboxRoot("../definitely-outside", "/repo/.sandbox"),
		/not inside the sandbox root/,
	);
});

test("assertPathInsideSandboxRoot: returns the resolved absolute path on success", () => {
	assert.equal(assertPathInsideSandboxRoot("/repo/.sandbox", "/repo/.sandbox"), "/repo/.sandbox");
});

// ---- forbiddenResetTargets — PURE. The operator's real, well-known paths, named explicitly
// in this task's Global Constraints — checked independently of assertPathInsideSandboxRoot,
// not in place of it. ----

test("forbiddenResetTargets: names exactly ~/.refarm, ~/.silo, ~/.local/share/refarm under a given home", () => {
	assert.deepEqual(forbiddenResetTargets("/home/fixture"), [
		path.join("/home/fixture", ".refarm"),
		path.join("/home/fixture", ".silo"),
		path.join("/home/fixture", ".local", "share", "refarm"),
	]);
});

// ---- resetSandbox — the impure edge. Filesystem-scoped to mkdtempSync fixtures throughout;
// no test in this section ever touches the real ~/.refarm, ~/.silo, or ~/.local/share/refarm. ----

function withResetFixture(fn) {
	const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sandbox-reset-"));
	try {
		return fn(repoRoot);
	} finally {
		fs.rmSync(repoRoot, { recursive: true, force: true });
	}
}

function buildFullSandboxFixture(repoRoot) {
	const { env } = sandboxEnvironment(repoRoot);
	fs.mkdirSync(env.REFARM_HOME, { recursive: true });
	fs.mkdirSync(env.XDG_DATA_HOME, { recursive: true });
	fs.mkdirSync(env.SILO_HOME, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(env.SILO_HOME, "identity.json"), JSON.stringify({ tokens: {} }), { mode: 0o600 });
	fs.writeFileSync(path.join(env.SOVEREIGN_BASE, SANDBOX_LOG_FILE_NAME), "fixture log content\n");
	return env;
}

test("resetSandbox: nothing on disk → succeeds as a no-op, never throws", () => {
	withResetFixture((repoRoot) => {
		const result = resetSandbox(repoRoot);
		assert.equal(result.deleted, false);
		assert.match(result.reason, /nothing to reset/);
	});
});

test("resetSandbox: deletes a full, realistic sandbox tree entirely (not-running node)", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		const result = resetSandbox(repoRoot, { getStatus: () => ({ node: { state: "not-running", pid: null } }) });
		assert.equal(result.deleted, true);
		assert.equal(fs.existsSync(env.SOVEREIGN_BASE), false);
	});
});

// ---- Code review follow-up (Important): every OTHER resetSandbox test above/below injects
// `getStatus`, so each LAYER (resetSandbox's own guards, sandboxStatus, parseSandboxPidFile)
// was tested, but never the SEAM between resetSandbox and the real sandboxStatus it defaults
// to. This test omits `getStatus` entirely — the default `getStatus = sandboxStatus` runs
// for real against the fixture — proving resetSandbox → sandboxStatus → parseSandboxPidFile
// actually compose, not just that each piece behaves correctly in isolation. ----

test("resetSandbox: composes with the REAL default sandboxStatus (no getStatus override) — no pid file on disk, so it resolves not-running and deletes", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		// No pid file written — the real sandboxStatus sees {kind:"missing"}, which
		// parseSandboxPidFile resolves to "not-running" without any liveness probe running.
		const result = resetSandbox(repoRoot);
		assert.equal(result.deleted, true);
		assert.equal(fs.existsSync(env.SOVEREIGN_BASE), false);
	});
});

test("resetSandbox: refuses when the sandbox node is RUNNING — deletes nothing", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		assert.throws(
			() => resetSandbox(repoRoot, { getStatus: () => ({ node: { state: "running", pid: 555 } }) }),
			/RUNNING/,
		);
		assert.equal(fs.existsSync(env.SOVEREIGN_BASE), true, "a refused reset must not delete anything");
	});
});

test("resetSandbox: refuses when the sandbox node's liveness is UNKNOWN — deletes nothing, does not guess", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		assert.throws(
			() => resetSandbox(repoRoot, { getStatus: () => ({ node: { state: "unknown", pid: 555 } }) }),
			/could not confidently determine|unknown/i,
		);
		assert.equal(fs.existsSync(env.SOVEREIGN_BASE), true);
	});
});

// ---- Code review follow-up (Critical, "the fifteenth instance"): the delete guard was a
// BLACKLIST ("running" and "unknown" refuse, everything ELSE proceeds), not a WHITELIST
// ("not-running" proceeds, everything else refuses). A blacklist is only complete while the
// set of states classifySandboxLiveness can produce never changes — this plan's own roadmap
// (a `stop` subcommand, a future "starting" state) makes a fourth state plausible, and JS
// gives no exhaustiveness error when the producer changes and this consumer is not updated
// to match. This test pins the exact scenario the reviewer demonstrated: an UNRECOGNIZED
// state string (not "running", not "unknown", not "not-running") must refuse, not delete —
// proving the guard degrades to "refuse" on the unknown case, mirroring
// classifySandboxLiveness's own `if (killOutcome !== "alive") return "unknown"` shape. ----

test("resetSandbox: refuses on an UNRECOGNIZED liveness state (not 'running', 'unknown', or 'not-running') — the whitelist, not a blacklist, is what makes this safe", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		assert.throws(
			() =>
				resetSandbox(repoRoot, {
					getStatus: () => ({ node: { state: "not-running-typo", pid: 555 } }),
				}),
			/not-running-typo/,
		);
		assert.equal(fs.existsSync(env.SOVEREIGN_BASE), true, "an unrecognized state must never be treated as safe to delete");
	});
});

test("resetSandbox: refuses on a PLAUSIBLE future state ('starting') exactly like 'unknown' — a fourth state added to the producer and never taught to this guard still refuses", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		assert.throws(
			() => resetSandbox(repoRoot, { getStatus: () => ({ node: { state: "starting", pid: 555 } }) }),
			/starting/,
		);
		assert.equal(fs.existsSync(env.SOVEREIGN_BASE), true);
	});
});

test("resetSandbox: refuses when the computed target collides with an (injected) forbidden path — proves the wiring, not just the pure function", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		assert.throws(
			() =>
				resetSandbox(repoRoot, {
					forbiddenTargets: [env.SOVEREIGN_BASE],
					getStatus: () => ({ node: { state: "not-running", pid: null } }),
				}),
			/collides with the operator's real/,
		);
		assert.equal(fs.existsSync(env.SOVEREIGN_BASE), true);
	});
});

test("resetSandbox: refuses a sibling directory that merely shares a string prefix (.sandboxes) — that decoy, and its canary file, survive untouched", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		const decoyDir = path.join(repoRoot, ".sandboxes");
		fs.mkdirSync(decoyDir, { recursive: true });
		const canary = path.join(decoyDir, "canary.txt");
		fs.writeFileSync(canary, "must survive");

		const result = resetSandbox(repoRoot, { getStatus: () => ({ node: { state: "not-running", pid: null } }) });

		assert.equal(result.deleted, true);
		assert.equal(fs.existsSync(env.SOVEREIGN_BASE), false, "the real .sandbox must still be deleted");
		assert.equal(fs.existsSync(decoyDir), true, "the .sandboxes decoy must survive");
		assert.equal(fs.readFileSync(canary, "utf8"), "must survive");
	});
});

test("resetSandbox: refuses outright when the sandbox root ITSELF is a symlink to somewhere else — the decoy target is never touched, and nothing is deleted", () => {
	withResetFixture((repoRoot) => {
		const decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sandbox-reset-decoy-"));
		try {
			const canary = path.join(decoyRoot, "canary.txt");
			fs.writeFileSync(canary, "must survive");
			const sandboxPath = path.join(repoRoot, ".sandbox");
			fs.symlinkSync(decoyRoot, sandboxPath, "dir");

			assert.throws(
				() => resetSandbox(repoRoot, { getStatus: () => ({ node: { state: "not-running", pid: null } }) }),
				/symlink/i,
			);

			assert.equal(fs.existsSync(canary), true, "the decoy target must never be touched");
			assert.equal(fs.readFileSync(canary, "utf8"), "must survive");
			assert.equal(fs.existsSync(sandboxPath), true, "a refused reset must not even remove the symlink itself");
		} finally {
			fs.rmSync(decoyRoot, { recursive: true, force: true });
		}
	});
});

test("resetSandbox: refuses outright when a symlink exists ANYWHERE nested inside the sandbox tree — the decoy target is never touched", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		const decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sandbox-reset-nested-decoy-"));
		try {
			const canary = path.join(decoyRoot, "canary.txt");
			fs.writeFileSync(canary, "must survive");
			// Nested arbitrarily deep, to prove the scan is recursive, not just one level.
			const nestedLinkDir = path.join(env.REFARM_HOME, "nested", "deeper");
			fs.mkdirSync(nestedLinkDir, { recursive: true });
			fs.symlinkSync(decoyRoot, path.join(nestedLinkDir, "escape-link"), "dir");

			assert.throws(
				() => resetSandbox(repoRoot, { getStatus: () => ({ node: { state: "not-running", pid: null } }) }),
				/symlink/i,
			);

			assert.equal(fs.existsSync(canary), true, "the decoy target must never be touched");
			assert.equal(fs.existsSync(env.SOVEREIGN_BASE), true, "a refused reset must not delete anything, even partially");
		} finally {
			fs.rmSync(decoyRoot, { recursive: true, force: true });
		}
	});
});

test("resetSandbox: is independent of process.cwd() — a decoy .sandbox sitting under the CURRENT working directory must never be touched when repoRoot is an unrelated absolute path", () => {
	withResetFixture((repoRoot) => {
		const env = buildFullSandboxFixture(repoRoot);
		const decoyCwdRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sandbox-reset-decoy-cwd-"));
		const decoySandbox = path.join(decoyCwdRoot, ".sandbox");
		fs.mkdirSync(decoySandbox, { recursive: true });
		const canary = path.join(decoySandbox, "canary.txt");
		fs.writeFileSync(canary, "must survive");

		const originalCwd = process.cwd();
		try {
			process.chdir(decoyCwdRoot);
			const result = resetSandbox(repoRoot, { getStatus: () => ({ node: { state: "not-running", pid: null } }) });
			assert.equal(result.deleted, true);
			assert.equal(fs.existsSync(env.SOVEREIGN_BASE), false, "the REAL repoRoot's sandbox must still be deleted");
			assert.equal(fs.existsSync(decoySandbox), true, "the decoy .sandbox under cwd must survive");
			assert.equal(fs.readFileSync(canary, "utf8"), "must survive");
		} finally {
			process.chdir(originalCwd);
			fs.rmSync(decoyCwdRoot, { recursive: true, force: true });
		}
	});
});
