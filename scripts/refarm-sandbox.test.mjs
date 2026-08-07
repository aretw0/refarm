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
	copySandboxCredentials,
	minimalCredentialTokens,
	OPERATOR_SILO_IDENTITY_PATH,
	parseShellExports,
	RESERVED_FLAGS,
	SANDBOX_HTTP_PORT,
	SANDBOX_NAMESPACE,
	SANDBOX_PORT,
	sandboxAgentPluginPath,
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
