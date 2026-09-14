import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// ── One installer, one path ──────────────────────────────────────────────────
// The agent plugin used to have TWO installers writing TWO directories:
// `refarm plugin install` wrote `$REFARM_HOME/plugins/refarm_agent/` (the CLI's
// pluginIdToFsToken layout), while `scripts/agent-install.mjs` — invoked by this start
// script — wrote `$REFARM_HOME/plugins/@refarm/agent/`, which the script then hardcoded
// as the path it loaded. So `refarm plugin install` could truthfully report "already
// up-to-date" about a directory nothing loaded, and the recovery handoff it printed on
// failure named a command that could not fix the problem.
//
// The behavioural pins (the installer writes where the resolver points; a legacy-only
// node still boots) live in apps/refarm/test/commands/plugin-install-path.test.ts, which
// executes both sides. These are the cheap static mutation guards in the start script's
// own home: no daemon boot, no build, just read the files.

test("the second installer is gone — nothing but the CLI installs the agent", () => {
	assert.ok(
		!existsSync(resolve("scripts/agent-install.mjs")),
		"scripts/agent-install.mjs was a second installer writing a second directory; it must " +
			"not come back — `refarm plugin install` is the one installer",
	);
	const source = readFileSync(tractorStart, "utf8");
	assert.ok(
		!/agent-install\.mjs/.test(source.replace(/#.*$/gm, "")),
		"tractor-start.sh must not invoke a private agent installer (comments may still " +
			"explain the history)",
	);
});

test("tractor-start.sh asks the CLI where the installed agent is, instead of spelling a layout", () => {
	const source = readFileSync(tractorStart, "utf8");
	assert.match(
		source,
		/INSTALLED_AGENT_PLUGIN="\$\(\s*\n\s*REFARM_HOME="\$REFARM_HOME" node "\$ROOT\/scripts\/installed-plugin-path\.mjs"/,
		"tractor-start.sh must derive the loaded path from the installer's own path function",
	);
	assert.ok(
		!/INSTALLED_AGENT_PLUGIN="\$REFARM_HOME/.test(source),
		"tractor-start.sh must not hardcode an install layout — that is how two install " +
			"directories happened",
	);
});

test("the bridge resolves the path through the compiled single path function", () => {
	const source = readFileSync(resolve("scripts/installed-plugin-path.mjs"), "utf8");
	assert.match(
		source,
		/"plugin-install-path\.js"/,
		"installed-plugin-path.mjs must import the compiled path module, not re-derive the layout",
	);
	assert.match(source, /installedPluginWasmPath/);
});

test("tractor-start.sh keeps the legacy scoped directory as a READ-ONLY fallback", () => {
	// A node installed before the convergence loads `plugins/@refarm/agent/plugin.wasm`.
	// The script must still boot it (loudly), and must never write it.
	const source = readFileSync(tractorStart, "utf8");
	assert.match(
		source,
		/LEGACY_AGENT_PLUGIN="\$REFARM_HOME\/plugins\/@refarm\/agent\/plugin\.wasm"/,
		"tractor-start.sh must name the legacy install path so a pre-convergence node boots",
	);
	assert.match(
		source,
		/resolve_installed_agent_plugin "\$INSTALLED_AGENT_PLUGIN" "\$LEGACY_AGENT_PLUGIN"/,
		"tractor-start.sh must resolve canonical-then-legacy through the sourced helper",
	);
});

test("tractor-start.sh reports a compiled agent the installer has not picked up", () => {
	// The old dist-stale guard was a SECOND installer reading the cargo target. The install
	// currency check (version + manifest integrity vs the freshly hashed source) is strictly
	// stronger than the mtime test it replaced, but it reads the npm package's copy — so a
	// bare `cargo component build` is invisible to it. That is a message to the human.
	const source = readFileSync(tractorStart, "utf8");
	assert.match(
		source,
		/\[ "\$AGENT_PLUGIN" -nt "\$PACKAGED_AGENT_WASM" \]/,
		"tractor-start.sh must notice when the compiled agent is newer than the packaged copy",
	);
	assert.match(
		source,
		/pnpm --filter @refarm\.dev\/agent run build/,
		"the notice must name the command that publishes the build into the package",
	);
});

test("scripts/agent-plugin-path.sh passes bash -n (syntax check)", () => {
	execFileSync("bash", ["-n", resolve("scripts/agent-plugin-path.sh")], { stdio: "pipe" });
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
	assert.match(source, /LEGACY_AGENT_PLUGIN="\$REFARM_HOME\/plugins\/@refarm\/agent\/plugin\.wasm"/);
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
