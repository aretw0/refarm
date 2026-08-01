import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const tractorStart = resolve("scripts/tractor-start.sh");

const helper = resolve("scripts/model-provider.sh");

function makeRoot() {
	const root = mkdtempSync(join(tmpdir(), "refarm-model-provider-root-"));
	mkdirSync(join(root, "packages/config/src"), { recursive: true });
	writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
	writeFileSync(
		join(root, "packages/config/src/model-routing.js"),
		"export const DEFAULT_MODEL_PROVIDER = 'openai';\n",
	);
	return root;
}

function makeHome() {
	const home = mkdtempSync(join(tmpdir(), "refarm-model-provider-home-"));
	mkdirSync(join(home, ".refarm"), { recursive: true });
	return home;
}

function resolveProvider(root, env = {}) {
	return execFileSync(
		"sh",
		[
			"-c",
			`. '${helper}'; resolve_refarm_model_provider "$1"`,
			"resolve-provider",
			root,
		],
		{
			encoding: "utf8",
			env: {
				PATH: process.env.PATH,
				HOME: env.HOME,
				MODEL_PROVIDER: env.MODEL_PROVIDER,
				MODEL_DEFAULT_PROVIDER: env.MODEL_DEFAULT_PROVIDER,
				REFARM_OPERATOR_IDENTITY_FILE: env.REFARM_OPERATOR_IDENTITY_FILE,
			},
		},
	);
}

test("runtime start helpers prefer explicit MODEL_PROVIDER", () => {
	const root = makeRoot();
	try {
		assert.equal(resolveProvider(root, { MODEL_PROVIDER: "gemini" }), "gemini");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("runtime start helpers prefer workspace config over operator identity", () => {
	const root = makeRoot();
	const home = makeHome();
	try {
		mkdirSync(join(root, ".refarm"), { recursive: true });
		writeFileSync(
			join(root, ".refarm/config.json"),
			JSON.stringify({ modelProvider: "anthropic" }),
		);
		writeFileSync(
			join(home, ".refarm/identity.json"),
			JSON.stringify({ modelProvider: "ollama" }),
		);

		assert.equal(resolveProvider(root, { HOME: home }), "anthropic");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("runtime start helpers read operator identity written by sow", () => {
	const root = makeRoot();
	const home = makeHome();
	try {
		writeFileSync(
			join(home, ".refarm/identity.json"),
			JSON.stringify({ modelProvider: "ollama", modelId: "llama3.2" }),
		);

		assert.equal(resolveProvider(root, { HOME: home }), "ollama");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("runtime start helpers infer provider from a default model route", () => {
	const root = makeRoot();
	const home = makeHome();
	try {
		writeFileSync(
			join(home, ".refarm/identity.json"),
			JSON.stringify({ modelRoutes: { default: "ollama/llama3.2" } }),
		);

		assert.equal(resolveProvider(root, { HOME: home }), "ollama");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("runtime start helpers fall back to shared default provider", () => {
	const root = makeRoot();
	const home = makeHome();
	try {
		assert.equal(resolveProvider(root, { HOME: home }), "openai");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

// ── Installed-agent filename consistency ─────────────────────────────────────
// The runtime failed to load the agent once because agent-install.mjs wrote
// `agent.wasm` while tractor-start.sh (and the daemon) read `plugin.wasm`. Both
// must agree on the canonical per-format name; this static guard fails fast if
// they ever drift again — no daemon boot, no build, just read the two files.
const CANONICAL_INSTALLED_AGENT_WASM = "plugin.wasm";

test("agent-install.mjs installs the agent as the canonical plugin.wasm", () => {
	const source = readFileSync(resolve("scripts/agent-install.mjs"), "utf8");
	// The destination the installer copies the built wasm to.
	assert.match(
		source,
		/const wasmDest = path\.join\(pluginDir, "plugin\.wasm"\)/,
		"agent-install.mjs must write the canonical plugin.wasm (not agent.wasm)",
	);
	assert.ok(
		source.includes(CANONICAL_INSTALLED_AGENT_WASM),
		"agent-install.mjs must reference plugin.wasm",
	);
});

test("tractor-start.sh reads the same canonical plugin.wasm the installer writes", () => {
	const source = readFileSync(resolve("scripts/tractor-start.sh"), "utf8");
	assert.match(
		source,
		/INSTALLED_AGENT_PLUGIN="\$REFARM_HOME\/plugins\/@refarm\/agent\/plugin\.wasm"/,
		"tractor-start.sh must resolve the installed agent at plugins/@refarm/agent/plugin.wasm",
	);
});

test("tractor-start.sh reinstalls when the compiled agent is newer than the installed copy", () => {
	// The dist-stale guard: a rename that moves the agent's WIT imports must not leave the
	// daemon loading an old installed copy. The start script must compare freshness (-nt)
	// and reinstall before launching.
	const source = readFileSync(resolve("scripts/tractor-start.sh"), "utf8");
	assert.match(
		source,
		/\[ "\$AGENT_PLUGIN" -nt "\$INSTALLED_AGENT_PLUGIN" \]/,
		"tractor-start.sh must detect a stale installed agent via a newer-than check",
	);
	assert.ok(
		/agent-install\.mjs/.test(source),
		"tractor-start.sh must reinstall (via agent-install.mjs) when the install is stale",
	);
});

// ── surfaces declaration doctrine: the launch script must never author it ────────
// docs/superpowers/specs/2026-07-29-declared-surfaces-design.md's whole doctrine is
// "the operator states intent as data; the runtime interprets it" — a launch script
// that reads-then-writes `surfaces.sidecar-http` into .refarm/config.json inverts
// that (what the machine declares becomes a function of how it was launched, and of
// whether `jq` happened to be installed). tractor-start.sh used to do exactly this
// via three now-deleted helpers; these are static, source-level mutation guards so a
// future edit cannot silently reintroduce that write path.
test("tractor-start.sh never writes .refarm/config.json", () => {
	const source = readFileSync(tractorStart, "utf8");

	// The three deleted synthesis helpers must never come back under any name.
	for (const helperName of [
		"_sidecar_surface_already_declared",
		"_declared_sidecar_expose_host",
		"_declare_container_sidecar_surface",
	]) {
		assert.ok(
			!source.includes(helperName),
			`tractor-start.sh must not reintroduce ${helperName} — the declaration is ` +
				"the operator's, not the launch script's, to author",
		);
	}

	// No shell redirection ever targets config.json (covers `> "$CONFIG_JSON"`,
	// `>"$CONFIG_JSON"`, `>>`, and a literal `.refarm/config.json` path spelled out
	// instead of through the variable).
	assert.ok(
		!/>>?\s*"?\$CONFIG_JSON"?/.test(source),
		"tractor-start.sh must not redirect output into $CONFIG_JSON",
	);
	assert.ok(
		!/>>?\s*"?[^"\s]*\.refarm\/config\.json"?/.test(source),
		"tractor-start.sh must not redirect output into a literal .refarm/config.json path",
	);

	// No `jq` invocation at all on this path (the write helpers were its only
	// consumer) — a bare grep for the binary name catches any reintroduction, even
	// one that does not touch CONFIG_JSON directly.
	assert.ok(
		!/\bjq\b/.test(source.replace(/#.*$/gm, "")),
		"tractor-start.sh must not depend on jq (stripped of comment lines, which may " +
			"still mention it historically)",
	);
});

test("tractor-start.sh shares the CLI operator home unless explicitly isolated", () => {
	const source = readFileSync(tractorStart, "utf8");
	assert.match(
		source,
		/REFARM_HOME="\$\{REFARM_HOME:-\$\{HOME:\?HOME must be set\}\/\.refarm\}"/,
	);
	assert.match(source, /INSTALLED_AGENT_PLUGIN="\$REFARM_HOME\/plugins\/@refarm\/agent\/plugin\.wasm"/);
});

test("tractor-start.sh passes bash -n (syntax check)", () => {
	// A cheap, direct syntax proof alongside the source-level assertions above —
	// catches an unbalanced `if`/`fi` or similar introduced while editing the bind
	// hosts block without needing to actually run the script.
	execFileSync("bash", ["-n", tractorStart], { stdio: "pipe" });
});

test("tractor-start.sh omits --http-host when REFARM_HTTP_HOST is unset (lets the declaration decide)", () => {
	const source = readFileSync(tractorStart, "utf8");
	assert.match(
		source,
		/if \[ "\$HAS_HTTP_HOST" = "0" \] && \[ -n "\$REFARM_HTTP_HOST" \]; then/,
		"tractor-start.sh must only forward --http-host when REFARM_HTTP_HOST is non-empty",
	);
	// Mutation guard against the old always-defaulted shape: no `:=127.0.0.1` default
	// assignment for REFARM_HTTP_HOST anywhere (that was Problem 1's root cause when
	// mirrored into the CLI flag itself — the script must not resurrect an equivalent).
	assert.ok(
		!/REFARM_HTTP_HOST:=/.test(source),
		"tractor-start.sh must not default REFARM_HTTP_HOST — an absent flag is what " +
			"lets surfaces.sidecar-http decide",
	);
});

test("tractor-start.sh omits --ws-host when REFARM_WS_HOST is unset (lets the declaration decide)", () => {
	const source = readFileSync(resolve("scripts/tractor-start.sh"), "utf8");
	assert.match(
		source,
		/if \[ "\$HAS_WS_HOST" = "0" \] && \[ -n "\$REFARM_WS_HOST" \]/,
		"tractor-start.sh must only forward --ws-host when REFARM_WS_HOST is non-empty",
	);
	assert.doesNotMatch(
		source,
		/REFARM_WS_HOST="127\.0\.0\.1"/,
		"tractor-start.sh must not default REFARM_WS_HOST — an absent flag is what " +
			"lets surfaces.daemon-ws decide",
	);
});
