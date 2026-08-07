#!/usr/bin/env node
/**
 * refarm-sandbox.mjs — a second, isolated refarm node, out of this working tree.
 *
 * WHY: the operator runs one refarm node ("sede") his daily life depends on. Developing
 * refarm against that SAME node means a test dispatch has nowhere else to land — on
 * 2026-08-05, 8 of 29 observations in his real BudgetObservation record were ours. This
 * script starts a SECOND node, isolated on the axis that actually matters (the graph —
 * see below), so a lab session can never write into the operator's real state.
 *
 * THE FOUR AXES — read
 * docs/superpowers/plans/2026-08-06-the-sandbox-node.md ("the four axes, measured
 * 2026-08-06") before changing anything here:
 *
 *   | Axis              | Relocated by                 | Follows REFARM_HOME? |
 *   | ----------------- | ---------------------------- | --------------------- |
 *   | Sovereign dir      | REFARM_HOME (main.rs:431)    | — it IS this          |
 *   | Graph (the nodes)  | XDG_DATA_HOME (sqlite.rs:433-438), + --namespace for the file | NO |
 *   | WebSocket surface  | --port  (main.rs default 42000) | no                  |
 *   | HTTP sidecar       | --http-port (main.rs default 42001) | no              |
 *
 * A launcher that relocates only the sovereign pair "isolates" a node that still opens
 * `~/.local/share/refarm/default.db` — the operator's real ledger. `sandboxEnvironment`
 * below declares all four, every time; its own test module asserts the graph declaration
 * exists AT ALL, which is the regression this file exists to close (the plan's first
 * draft had three axes and called it "everything").
 *
 * SCOPE — Tasks 1 and 2 (.superpowers/sdd/2026-08-06-the-sandbox-node/task-{1,2}-brief.md):
 *   - declares the four axes + both ports (`sandboxEnvironment`, PURE)
 *   - Task 1 started the sandbox daemon with NO `--plugin` and no credentials.
 *   - Task 2 (this revision) wires both, DELIBERATELY, not by default:
 *
 *     CREDENTIALS — inherited, never re-authenticated, but COPIED rather than shared by
 *     reference (Global Constraints: "a sandbox that can write the operator's credential
 *     store is not isolated"). The durable half is `~/.silo/identity.json`, read-only from
 *     here; `copySandboxCredentials` copies the MINIMUM subset the model-routing layer
 *     actually reads (`minimalCredentialTokens`) into `<repo>/.sandbox/silo/identity.json`
 *     — never the whole file, which also carries `githubToken`/`cloudflareToken`/the
 *     device identity block, none of which model routing touches. `SILO_HOME` (declared in
 *     `sandboxEnvironment`'s `env`, alongside — but NOT one of — the four isolation axes)
 *     points `@refarm.dev/silo`'s `resolveSiloHome()` at that copy instead of its default
 *     fallback chain (`SILO_HOME` → `REFARM_HOME` → `~/.silo`), which would otherwise
 *     silently resolve to the SANDBOX's own empty `REFARM_HOME` the moment that axis is
 *     declared (measured 2026-08-06: without `SILO_HOME`, `refarm model current --json`
 *     against the sandbox's other three axes alone falls all the way back to the keyless
 *     `ollama/llama3.2` floor — a plausible-looking wrong answer, not a crash). The
 *     env-var half (`OPENAI_CODEX_ACCESS_TOKEN`, `MODEL_PROVIDER`, …) is resolved by
 *     shelling out to the ALREADY-COMPILED `refarm model env --shell --include-secrets` —
 *     the exact command `scripts/tractor-start.sh` uses for the operator's own node —
 *     scoped to the sandbox's `SILO_HOME`, so this file never re-implements that
 *     resolution a second time (`resolveSandboxModelEnv`).
 *
 *     PLUGIN — the sandbox loads the WORKING TREE's freshly-built
 *     `packages/agent/dist/agent.wasm` (`sandboxAgentPluginPath`), not the operator's
 *     INSTALLED `~/.refarm/plugins/refarm_agent/plugin.wasm`. Both are defensible; this
 *     file picks "the lab runs what you are building" because the sandbox's entire reason
 *     to exist (see this file's opening paragraph) is testing refarm changes in progress —
 *     mirroring the operator's installed copy would mean every sandbox run needs a prior
 *     `refarm plugin install` into the SAME directory the operator's daemon also reads,
 *     reintroducing exactly the shared-surface risk this plan removes. Measured
 *     2026-08-06: their SHA-256 is IDENTICAL today (`6d78b1c15…5ae3eca`) — this choice has
 *     no behavioral effect yet, but will the moment `packages/agent/src` is edited and
 *     rebuilt without a matching `refarm plugin install`. A caller may still override via
 *     `startSandbox({ plugin })` or CLI `--plugin <path>` in `extraArgs` — but NOT by
 *     "last occurrence wins": every flag in `PLUGIN_LOADING_FLAGS` (`--plugin`, and
 *     `--plugin-by-hash` — main.rs's orphan-grant content-store loader) is a repeatable
 *     `Vec` on the Rust side, so clap-derive APPENDS every occurrence rather than letting a
 *     later one replace an earlier one — two loader flags load TWO plugins, both registered
 *     for events by their own INDEPENDENT boot loops, not one overriding the other. (A
 *     review missed `--plugin-by-hash` here once — see `PLUGIN_LOADING_FLAGS`'s doc for the
 *     fix and where the authoritative Rust-side list lives.) That is exactly why none of
 *     `PLUGIN_LOADING_FLAGS` is in `RESERVED_FLAGS` (see `assertNoReservedFlags`'s note)
 *     rather than handled the same way as the four scalar flags: `startSandbox` detects a
 *     caller-supplied plugin loader in `extraArgs` itself (`extraArgsSuppliesPlugin`) and,
 *     when present, does NOT also append the default — the caller's choice is the ONLY
 *     plugin loaded, not one of two.
 *
 *   - does NOT implement `status` or `--reset` (Task 3) or `refarm parity` (Task 5).
 *
 * Does NOT read or modify scripts/tractor-start.sh — the operator's launcher — in any way,
 * and NEVER writes to `~/.silo` or `~/.refarm` — both are read-only sources here.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tractorBinaryPath } from "./lib/cargo-target.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/** The sandbox's own sub-tree, sibling to nothing else this repo already uses. Must stay
 *  gitignored — see the ".gitignore" entry this task added alongside this file. */
export const SANDBOX_DIR_NAME = ".sandbox";

/** SOVEREIGN_DIR value for the sandbox — same meaning as the operator's ".refarm", scoped
 *  under SANDBOX_DIR_NAME instead of the OS home directory. */
export const SANDBOX_SOVEREIGN_DIR = "refarm";

/** Names the db file the sandbox opens: `<XDG_DATA_HOME>/refarm/sandbox.db`. Deliberately
 *  never "default" — that name is the operator's, inside his real `~/.local/share/refarm/`. */
export const SANDBOX_NAMESPACE = "sandbox";

/** SILO_HOME value for the sandbox — sibling of REFARM_HOME/XDG_DATA_HOME under
 *  SANDBOX_DIR_NAME. NOT one of "the four axes" (see this file's header): the axes
 *  ISOLATE state; this INHERITS it, by copy (`copySandboxCredentials`). Its only job is to
 *  stop `@refarm.dev/silo`'s `resolveSiloHome()` fallback chain (SILO_HOME → REFARM_HOME →
 *  ~/.silo) from resolving to the sandbox's own (empty) REFARM_HOME once that axis is
 *  declared — see the header comment for the measured defect this closes. */
export const SANDBOX_SILO_DIR_NAME = "silo";

/** The durable credential source this task copies FROM. Read-only, always — nothing in
 *  this file ever calls a write API against a path built from this constant. Hardcoded to
 *  `~/.silo/identity.json` (not derived via `resolveSiloHome()`) so the source is stable
 *  and legible regardless of what env vars happen to be set in the shell that launches the
 *  sandbox — the exact file named in task-2-brief.md as "the durable source". */
export const OPERATOR_SILO_IDENTITY_PATH = path.join(os.homedir(), ".silo", "identity.json");

/**
 * Chosen 2026-08-06 by checking `ss -ltn` against every listener on this host at the time,
 * including the operator's node (42000/42001, bound on both 127.0.0.1 and its Tailscale
 * address) — not picked because the numbers look nice. Declared as constants, matching how
 * the operator's own defaults are declared (`main.rs`'s `default_value_t = 42000` /
 * `42001`), rather than re-probed on every run, so the sandbox's address stays STABLE
 * across restarts and a tool like `refarm context` can name it. `startSandbox` (the impure
 * edge below) verifies both are still actually free immediately before every start and
 * refuses rather than silently colliding — a live check, run fresh each time, not a claim
 * this comment gets to make permanently.
 */
export const SANDBOX_PORT = 43000;
export const SANDBOX_HTTP_PORT = 43001;

/**
 * PURE. The declarations a sandbox node rooted at `repoRoot` needs — all four axes, every
 * time (see this file's header). `port`/`httpPort`/`namespace` are overridable parameters,
 * never derived here: finding an ACTUALLY FREE port is a live OS query (`isPortFree`
 * below) and belongs at the impure edge, never inside a function this file's own test
 * drives with literals.
 *
 * `REFARM_HOME` is deliberately the SAME directory `SOVEREIGN_BASE + SOVEREIGN_DIR`
 * resolves to: `declaredBase()` (`@refarm.dev/config`) derives the base from
 * `dirname(REFARM_HOME)`, so declaring both keeps the TypeScript stack and the Rust host
 * agreeing about the sandbox exactly as they already agree about the operator's node
 * (`packages/tractor/src/main.rs:443-446`, inside `run_daemon`, derives `SOVEREIGN_BASE`
 * from `refarm_dir.parent()` whenever it is left unset — NOT `dirs_sovereign_base()` at
 * `:773`, a different function that only supplies the fallback when `--refarm-dir` itself
 * is absent).
 *
 * `XDG_DATA_HOME` is a SIBLING of REFARM_HOME (`<repoRoot>/.sandbox/share`, never
 * `<repoRoot>/.sandbox/refarm/share`) — asserted as a sibling by this file's test, not
 * merely "somewhere under .sandbox", specifically so a later edit cannot quietly fold the
 * graph back under the sovereign dir and still pass a looser check.
 *
 * This function is the canonical recipe for reaching the sandbox: any later script that
 * needs to talk to it (credential copier, proof scripts, `refarm parity`) should import
 * this rather than re-deriving the paths.
 */
export function sandboxEnvironment(repoRoot, overrides = {}) {
	const sandboxBase = path.join(repoRoot, SANDBOX_DIR_NAME);
	const refarmHome = path.join(sandboxBase, SANDBOX_SOVEREIGN_DIR);
	const xdgDataHome = path.join(sandboxBase, "share");
	const siloHome = path.join(sandboxBase, SANDBOX_SILO_DIR_NAME);

	return {
		env: {
			SOVEREIGN_BASE: sandboxBase,
			SOVEREIGN_DIR: SANDBOX_SOVEREIGN_DIR,
			REFARM_HOME: refarmHome,
			// THE GRAPH — does NOT follow REFARM_HOME. storage/sqlite.rs's db_dir() reads
			// XDG_DATA_HOME directly; main.rs never threads REFARM_HOME through to it. Omitting
			// this key is the exact defect this task was written to close.
			XDG_DATA_HOME: xdgDataHome,
			// CREDENTIALS (Task 2) — the fifth declaration, deliberately NOT one of "the four
			// axes" above (see this file's header): it INHERITS state by copy rather than
			// isolating it. Without this, @refarm.dev/silo's resolveSiloHome() falls back to
			// REFARM_HOME (declared right above) the instant that axis exists, silently reading
			// an empty store instead of ~/.silo — the same "three states treated as complete"
			// shape the four-axes defect was.
			SILO_HOME: siloHome,
		},
		port: overrides.port ?? SANDBOX_PORT,
		httpPort: overrides.httpPort ?? SANDBOX_HTTP_PORT,
		namespace: overrides.namespace ?? SANDBOX_NAMESPACE,
	};
}

/**
 * Flags this launcher already owns and sets itself (see `startSandbox`'s `args` below).
 * A caller's `extraArgs` may never name one of these — see `assertNoReservedFlags`.
 */
export const RESERVED_FLAGS = ["--port", "--http-port", "--namespace", "--refarm-dir"];

/** PURE. The `--flag` portion of a single argv token, whether it arrived as `--flag value`
 * (the token itself IS the name) or `--flag=value` (split on the first `=`). Shared by
 * `assertNoReservedFlags` and `startSandbox`'s `--plugin` detection below, so "how do we
 * recognize a flag's name in extraArgs" has exactly one implementation. */
function flagNameOf(arg) {
	return arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
}

/**
 * PURE. Throws if `extraArgs` names any flag `startSandbox` already sets itself.
 *
 * WHY THIS EXISTS: `startSandbox`'s argv is built as `[--port, ..., --refarm-dir, ...,
 * ...extraArgs]` — the caller's args spread LAST. clap takes the LAST occurrence of a
 * scalar flag without erroring, so a caller passing `--refarm-dir` (or `--port`,
 * `--http-port`, `--namespace`) through `extraArgs` would silently WIN over this launcher's
 * own value and repoint the "sandbox" at whatever it names — this is not hypothetical:
 * scripts/tractor-start.sh builds its own args in exactly this shape (fixed flags first,
 * e.g. `--plugin`, then `--refarm-dir` added later), and Task 2 of this plan passes
 * `--plugin` through `extraArgs` next. A caller mirroring that shape and reusing an
 * operator value would start a SECOND tractor pointed at the operator's live `~/.refarm`,
 * concurrently with his running node, both writing `node.json`/`node-id`/`streams/`/
 * `task-results/` into the same directory — the graph would stay isolated; the other three
 * axes would not.
 *
 * Refuses rather than silently correcting (e.g. spreading extraArgs first instead): a
 * caller that passes one of these flags has a WRONG BELIEF about who owns it, and a silent
 * correction leaves that belief in place for the next call site. Catches the `--flag=value`
 * form as well as the two-token `--flag value` form — clap accepts both, so a check that
 * only caught one would be a gap dressed as a guard.
 */
export function assertNoReservedFlags(extraArgs) {
	for (const arg of extraArgs) {
		const name = flagNameOf(arg);
		if (RESERVED_FLAGS.includes(name)) {
			throw new Error(
				`refarm-sandbox: extraArgs may not pass ${name} — startSandbox() already sets it ` +
					"from sandboxEnvironment(). A caller naming it here has a wrong belief about who " +
					"owns that flag: the last occurrence would silently win (clap takes the last " +
					"value for a scalar flag without erroring) and could repoint the sandbox at the " +
					"operator's real --refarm-dir/ports. Remove it from extraArgs.",
			);
		}
	}
}

/**
 * PURE. Path the sandbox loads its agent plugin from — the WORKING TREE's freshly-built
 * `packages/agent/dist/agent.wasm`, deliberately NOT the operator's INSTALLED
 * `~/.refarm/plugins/refarm_agent/plugin.wasm`. See this file's header for the recorded
 * decision (both are defensible; this one because the sandbox exists to test refarm
 * changes in progress). `packages/agent/dist/` is the same "packaged" location
 * scripts/tractor-start.sh's PACKAGED_AGENT_WASM names and `refarm plugin install` reads
 * FROM — so this is the artifact one build (`pnpm --filter @refarm.dev/agent run build` /
 * `cargo component build --release -p agent` + publish) away from any edit, with no
 * install step into a shared directory required in between.
 */
export function sandboxAgentPluginPath(repoRoot) {
	return path.join(repoRoot, "packages", "agent", "dist", "agent.wasm");
}

/**
 * THE authoritative set of CLI flags that cause `packages/tractor`'s `main.rs` to load AND
 * register a plugin at boot — ONE named thing, read by BOTH `extraArgsSuppliesPlugin`
 * (skip the default when the caller already named one of these) and `pluginLoadersIn`
 * (report what was actually loaded). A future third loader flag must be added HERE, or it
 * is honoured by neither — the exact shape `--plugin-by-hash` slipped through in: it was
 * missed from the allowlist entirely, not deliberately scoped out, because the set lived
 * as two separate hardcoded checks instead of one.
 *
 * Verified against `packages/tractor/src/main.rs` (2026-08-07) — that file is the
 * authoritative source, not this comment; re-check it before trusting this list:
 *   - the `#[arg(long, ...)]` declarations: `plugin: Vec<PathBuf>` (`:82`, "may be
 *     repeated") and `plugin_by_hash: Vec<String>` (`:88`, "(repeatable)").
 *   - the two INDEPENDENT boot-time loops in `run_daemon`, each calling `.load_plugin*()` +
 *     `.register_for_events()` on EVERY entry, neither gated on the other running:
 *     `for path in &args.plugin` (~`:582`) and `for spec in &args.plugin_by_hash`
 *     (~`:612`).
 *   - confirmed exhaustive by grepping the crate for every `register_for_events` call
 *     site: the only other three are the respawn supervisor (reloading a CRASHED plugin,
 *     not a new one from a flag), the sidecar's runtime plugin-install HTTP endpoint (not
 *     a boot CLI flag), and `tractor-bench` (a different binary this launcher never
 *     spawns) — none of them read a `--plugin*` flag.
 *
 * `--plugin`'s value is a real path; `--plugin-by-hash`'s is
 * `<assetsDir>:<hash>:<manifestPath>` — NOT a path. Each entry's `describeValue` says
 * which, so `pluginLoadersIn` never reports a hash-spec as if it were a plain plugin path.
 */
export const PLUGIN_LOADING_FLAGS = {
	"--plugin": { describeValue: (value) => value },
	"--plugin-by-hash": { describeValue: (value) => `[by-hash] ${value}` },
};

/**
 * PURE. True when `extraArgs` already names ANY flag in `PLUGIN_LOADING_FLAGS` (either
 * `--flag value` or `--flag=value`) — the signal `startSandbox` uses to skip appending its
 * OWN default plugin. Appending both would load TWO plugins, not let the caller's override
 * one: unlike the four `RESERVED_FLAGS`, every flag in `PLUGIN_LOADING_FLAGS` is a
 * repeatable `Vec` on the Rust side, so clap-derive APPENDS every occurrence instead of a
 * later one replacing an earlier one.
 */
export function extraArgsSuppliesPlugin(extraArgs) {
	return extraArgs.some((arg) => Object.hasOwn(PLUGIN_LOADING_FLAGS, flagNameOf(arg)));
}

/**
 * Decide the `--plugin <path>` args (and any notice) `startSandbox` should add for its
 * OWN default plugin, given the resolved `plugin` path and the caller's `extraArgs`.
 * Exported and called BY `startSandbox` (never re-implemented inline there) so a test can
 * exercise the actual decision `startSandbox` runs — not a hand-copied second version that
 * can silently drift from it, the exact gap a prior review found in `RESERVED_FLAGS`'s
 * test coverage. `existsSync` is injectable so tests can drive both branches (plugin file
 * present/absent) without touching the real filesystem.
 *
 * Returns `{ pluginArgs: [], notice: undefined }` when a caller already supplied a plugin
 * through ANY `PLUGIN_LOADING_FLAGS` member — see `extraArgsSuppliesPlugin`'s doc for why
 * appending the default on top would load a SECOND plugin instead of letting the caller's
 * be the only one.
 */
export function resolveDefaultPluginArgs(plugin, extraArgs, { existsSync = fs.existsSync } = {}) {
	if (!plugin || extraArgsSuppliesPlugin(extraArgs)) {
		return { pluginArgs: [], notice: undefined };
	}
	if (!existsSync(plugin)) {
		return {
			pluginArgs: [],
			notice:
				`agent plugin not found at ${plugin} — starting with NO plugin. Build it: ` +
				"pnpm --filter @refarm.dev/agent run build",
		};
	}
	return { pluginArgs: ["--plugin", plugin], notice: undefined };
}

/**
 * PURE. Every plugin-loading value present in an already-assembled tractor argv array —
 * i.e. every occurrence of any flag in `PLUGIN_LOADING_FLAGS` (both `--flag value` and
 * `--flag=value` forms), in the order they appear, each rendered through that flag's own
 * `describeValue` so a `--plugin-by-hash` spec is never printed/reported as if it were a
 * plain `--plugin` path. This is the launcher-side mirror of `main.rs`'s two boot loops:
 * reads the SAME array passed to `spawn()`, so what a caller is told was loaded (see
 * `startSandbox`'s `plugins`) can never drift from what the daemon actually loads.
 */
export function pluginLoadersIn(args) {
	const loaders = [];
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		const name = flagNameOf(arg);
		const descriptor = PLUGIN_LOADING_FLAGS[name];
		if (!descriptor) continue;
		if (arg.includes("=")) {
			loaders.push(descriptor.describeValue(arg.slice(arg.indexOf("=") + 1)));
			continue;
		}
		if (i + 1 < args.length) {
			loaders.push(descriptor.describeValue(args[i + 1]));
			i += 1;
		}
	}
	return loaders;
}

/**
 * PURE. Given a parsed Silo `tokens` object (the shape `SiloCore#loadTokens()` returns —
 * i.e. `JSON.parse(readFileSync(identity.json)).tokens`), return ONLY the fields
 * `packages/config/src/model-routing.js` (`modelCredentialStatus`/`modelOAuthCredential`)
 * and `apps/refarm/src/commands/model.ts` (`buildModelEnvEntries`/`runtimeOAuthCredential`)
 * actually read to resolve and export a model route: `modelProvider`, `modelId`,
 * `modelApiKey` (the API-key tier — unused by this operator's openai-codex/oauth setup
 * today, kept for whichever provider a future sandbox run might be configured for), and —
 * for the OAuth tier — `oauthProvider` plus JUST that one provider's `{access, accountId,
 * expires}`.
 *
 * SOURCE OF TRUTH FOR "WHICH FIELDS": every `tokens.<field>` access in
 * `apps/refarm/src/commands/model.ts` and `packages/config/src/model-routing.js`,
 * enumerated 2026-08-07 (not "the fields I happened to trace" — a review caught exactly
 * that gap once already, see below). `buildCurrentModelStatus` (`model.ts:897-…`, the
 * single implementation `buildModelEnvEntries` AND `formatCurrentModel` both go through)
 * reads: `modelProvider`, `modelId`, `model` (a legacy alias for `modelId`, read directly
 * by `effectiveModelRouteForScope` at `model-routing.js:260` — `stringValue(tokens.modelId)
 * ?? stringValue(tokens.model)`), `modelBaseUrl` (`model.ts:915`), `modelFallbackProvider`
 * (`:917`), `modelFallbackModelId` (`:922`), `modelApiKey` (the API-key tier,
 * `model-routing.js:119`), and — oauth tier — `oauthProvider`/`oauthCredentials`
 * (`model-routing.js:101-105`). Every one of those is kept below.
 *
 * Deliberately DROPS:
 *   - `refresh` — the OAuth refresh token. Verified 2026-08-06 by a repo-wide grep for
 *     `.refreshToken(`: nothing in this codebase calls `OAuthProviderInterface#refreshToken`
 *     today, so a sandbox copy missing it loses no CURRENTLY working capability — and a
 *     refresh token can mint new access tokens indefinitely, a strictly more powerful
 *     credential than the access token it would sit next to for a capability nothing
 *     exercises. Copying it would violate "minimum set" for zero functional gain.
 *   - `githubToken`, `githubOwner`, `cloudflareToken` — unrelated integrations. Not read by
 *     `SiloCore#loadTokens()`'s only model-routing consumer, and copying them would hand
 *     the sandbox two MORE live credentials than the one thing this task needs to prove.
 *   - any OTHER oauth providers' entries in `oauthCredentials` (only `tokens.oauthProvider`'s
 *     own entry survives) — `modelOAuthCredential()` only ever reads the ACTIVE provider's
 *     entry, so copying the rest is dead weight with the same over-copy problem.
 *   - the identity block (`masterPublicKey`, `bootstrappedAt`) — device identity, not part
 *     of `.tokens` at all, so `loadTokens()` never even returns it to a caller.
 *   - `modelRoutes` — EXCLUDED DELIBERATELY, not an oversight: `effectiveModelRouteForScope`
 *     only ever consults it for the `worker`/`monitor` SCOPES (`model-routing.js:277`,
 *     `routes[scope]`), and `buildModelEnvEntries` (the function that decides what actually
 *     gets exported as an env var) never exports a worker/monitor-scoped variable at all —
 *     `MODEL_RUNTIME_ENV_VARS` (`model-routing.js:20-28`) only ever carries the DEFAULT
 *     scope's provider/id/base-url/fallback. A sandbox missing `modelRoutes` therefore
 *     resolves the identical env-var set a copy WITH it would — it only changes what
 *     `refarm model current`'s TEXT DISPLAY shows for the worker/monitor rows, which this
 *     task's proof (`refarm model current --json`'s `credential`/`current` fields) never
 *     depends on. Dormant today either way: the operator's live identity carries no
 *     `modelRoutes` entry.
 *
 * Returns `{}` for input that names no usable credential (e.g. an oauth provider whose
 * entry is missing `access`), so a caller can tell "nothing to copy" from "copied nothing
 * on purpose" without a try/catch.
 */
export function minimalCredentialTokens(tokens = {}) {
	const result = {};
	if (typeof tokens.modelProvider === "string" && tokens.modelProvider.trim()) {
		result.modelProvider = tokens.modelProvider;
	}
	if (typeof tokens.modelId === "string" && tokens.modelId.trim()) {
		result.modelId = tokens.modelId;
	}
	// Legacy alias for modelId — effectiveModelRouteForScope() falls back to THIS field
	// when modelId is absent (model-routing.js:260). Keeping modelId alone would silently
	// drop a route an operator set through the legacy field.
	if (typeof tokens.model === "string" && tokens.model.trim()) {
		result.model = tokens.model;
	}
	if (typeof tokens.modelBaseUrl === "string" && tokens.modelBaseUrl.trim()) {
		result.modelBaseUrl = tokens.modelBaseUrl;
	}
	if (typeof tokens.modelFallbackProvider === "string" && tokens.modelFallbackProvider.trim()) {
		result.modelFallbackProvider = tokens.modelFallbackProvider;
	}
	if (typeof tokens.modelFallbackModelId === "string" && tokens.modelFallbackModelId.trim()) {
		result.modelFallbackModelId = tokens.modelFallbackModelId;
	}
	if (typeof tokens.modelApiKey === "string" && tokens.modelApiKey.trim()) {
		result.modelApiKey = tokens.modelApiKey;
	}

	const oauthProvider = typeof tokens.oauthProvider === "string" ? tokens.oauthProvider : undefined;
	const oauthCredentials =
		tokens.oauthCredentials && typeof tokens.oauthCredentials === "object" ? tokens.oauthCredentials : undefined;
	const activeCredential = oauthProvider && oauthCredentials ? oauthCredentials[oauthProvider] : undefined;

	if (activeCredential && typeof activeCredential === "object" && typeof activeCredential.access === "string" && activeCredential.access.trim()) {
		const minimalCredential = { access: activeCredential.access };
		if (typeof activeCredential.accountId === "string" && activeCredential.accountId.trim()) {
			minimalCredential.accountId = activeCredential.accountId;
		}
		if (typeof activeCredential.expires === "number") {
			minimalCredential.expires = activeCredential.expires;
		}
		result.oauthProvider = oauthProvider;
		result.oauthCredentials = { [oauthProvider]: minimalCredential };
	}

	return result;
}

/**
 * PURE. Inverse of `apps/refarm/src/commands/model.ts`'s `shellQuote`/`formatModelEnvShell`
 * — parses the `export KEY='value'` lines `refarm model env --shell` prints back into a
 * plain object, so `resolveSandboxModelEnv` never has to `eval` untrusted-shaped shell text
 * the way `scripts/tractor-start.sh` does. Ignores lines that are not `export NAME=...`
 * (blank lines, anything else). Unescapes the single-quote-wrapped form `shellQuote`
 * produces (`'\''` inside the quotes → a literal `'`); a value that arrives unquoted is
 * used as-is.
 *
 * REFUSES (throws) rather than silently truncating a value that looks like the START of a
 * single-quoted token whose closing quote never arrives on the SAME physical line.
 * `shellQuote` (`model.ts:259-261`) escapes `'` but never a raw `\n`, and this parser reads
 * line-by-line — so a value containing an embedded newline would otherwise split across
 * two "lines", the first parsed as a (wrongly) complete export with everything after the
 * newline silently dropped, the second silently skipped as "not an export line". Not
 * reachable with today's JWT-shaped credential values, but a silently truncated credential
 * is the worst failure mode available here — refuse rather than guess.
 */
export function parseShellExports(text) {
	const entries = {};
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const match = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
		if (!match) continue;
		const [, key, rawValue] = match;
		entries[key] = unquoteShellValue(key, rawValue);
	}
	return entries;
}

function unquoteShellValue(key, raw) {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("'")) return trimmed;
	const closed = closedSingleQuotedValue(trimmed);
	if (closed === null) {
		throw new Error(
			`parseShellExports: the value for ${key} looks like an UNCLOSED single-quoted ` +
				"shell token on this line — refusing rather than silently truncating it. The " +
				"most likely cause is a raw, unescaped newline inside the value (shellQuote " +
				"escapes ' but not \\n, and this parser reads line-by-line).",
		);
	}
	return closed;
}

/**
 * PURE. `value` is assumed to already start with `'` (checked by the caller). Returns the
 * unescaped content if `value` is a COMPLETE, single-line `shellQuote()`-shaped token —
 * `'`, then any run of (non-quote characters | the 4-char escape `'\''`), then a closing
 * `'` with NOTHING trailing after it. Returns `null` if the scan runs off the end of
 * `value` without ever finding that closing quote — i.e. the token never closes on this
 * line — or if there is leftover content after a quote that did close.
 */
function closedSingleQuotedValue(value) {
	let i = 1;
	while (i < value.length) {
		if (value.startsWith("'\\''", i)) {
			i += 4;
			continue;
		}
		if (value[i] === "'") {
			return i === value.length - 1 ? value.slice(1, i).replace(/'\\''/g, "'") : null;
		}
		i += 1;
	}
	return null;
}

// ---- Impure edge: everything below touches the filesystem, the network, or a process. ----

/**
 * Is `port` free on 127.0.0.1 right now? Binds and immediately releases — verified fresh
 * before every start rather than trusted from whenever SANDBOX_PORT/SANDBOX_HTTP_PORT were
 * chosen. Loopback only: with no `--ws-host`/`--http-host` flag passed below, an undeclared
 * `surfaces.*` makes the daemon bind loopback (see scripts/tractor-start.sh's "bind hosts"
 * block) — checking anything wider would test an interface the daemon never touches.
 */
function isPortFree(port) {
	return new Promise((resolveFree) => {
		const server = net.createServer();
		server.once("error", () => resolveFree(false));
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolveFree(true));
		});
	});
}

/**
 * Copy the MINIMUM credential set (`minimalCredentialTokens`) from `sourcePath` (default
 * `OPERATOR_SILO_IDENTITY_PATH`, i.e. `~/.silo/identity.json`) into
 * `<repoRoot>/.sandbox/silo/identity.json` — the file `SILO_HOME` (declared in
 * `sandboxEnvironment`) points `@refarm.dev/silo`'s `resolveSiloHome()` at.
 *
 * READS `sourcePath`, never writes it — the operator's real store is a read-only input
 * here, always. Overwrites the destination on every call (re-running `start` re-syncs a
 * rotated token automatically; nothing here reads the OLD destination content first).
 *
 * Refuses to throw: a missing/unreadable/malformed source degrades the sandbox to the
 * keyless `ollama` floor (proven live in task-2-report.md) rather than blocking it from
 * starting at all — this mirrors scripts/tractor-start.sh's own "⚠ No .refarm/.env found"
 * non-fatal warning for the same class of problem. Returns `{ copied: false, reason }` in
 * every such case instead, so the caller can print exactly why.
 */
export function copySandboxCredentials(repoRoot, { sourcePath = OPERATOR_SILO_IDENTITY_PATH } = {}) {
	const destPath = path.join(sandboxEnvironment(repoRoot).env.SILO_HOME, "identity.json");

	if (!fs.existsSync(sourcePath)) {
		return { copied: false, reason: `no credential source at ${sourcePath}`, destPath };
	}

	let parsedSource;
	try {
		parsedSource = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
	} catch (err) {
		return { copied: false, reason: `source is not valid JSON (${sourcePath}): ${err.message}`, destPath };
	}

	const tokens = minimalCredentialTokens(parsedSource?.tokens ?? {});
	if (Object.keys(tokens).length === 0) {
		return { copied: false, reason: `source names no usable credential (${sourcePath})`, destPath };
	}

	const destDir = path.dirname(destPath);
	fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
	const store = {
		schemaVersion: typeof parsedSource?.schemaVersion === "number" ? parsedSource.schemaVersion : 1,
		tokens,
		updatedAt: new Date().toISOString(),
	};
	fs.writeFileSync(destPath, JSON.stringify(store, null, 2), { mode: 0o600 });
	// writeFileSync's `mode` option only applies when the file is CREATED — an existing
	// destination (a re-sync) keeps whatever mode it already had unless set explicitly here.
	fs.chmodSync(destPath, 0o600);
	fs.chmodSync(destDir, 0o700);

	return {
		copied: true,
		destPath,
		provider: tokens.modelProvider,
		hasOAuth: Boolean(tokens.oauthProvider),
	};
}

/**
 * IMPURE. Resolves the sandbox's model-runtime env entries by shelling out to the
 * ALREADY-COMPILED `refarm model env --shell --include-secrets` — the exact command
 * `scripts/tractor-start.sh` uses for the operator's own node (its "provider selection"
 * block) — with `SILO_HOME` overridden to `siloHome` so it reads the SANDBOX's copied
 * credential store, never the operator's. Reusing this command (rather than re-deriving
 * "which vars, from which Silo fields" here) is deliberate: that resolution already has one
 * implementation (`apps/refarm/src/commands/model.ts`'s `buildModelEnvEntries`), and this
 * codebase has repeatedly paid for a second one drifting from the first (see
 * scripts/tractor-start.sh's "ONE installer now" comment for the plugin-side instance of
 * the same defect).
 *
 * Never throws: a missing/unbuilt CLI or a failing subprocess returns `{ entries: {},
 * reason }` so a caller degrades gracefully (same "keyless floor, not a crash" contract as
 * `copySandboxCredentials`).
 */
export function resolveSandboxModelEnv(repoRoot, { siloHome } = {}) {
	const cli = path.join(repoRoot, "apps", "refarm", "dist", "index.js");
	if (!fs.existsSync(cli)) {
		return { entries: {}, reason: `refarm CLI not built at ${cli} — run: pnpm --filter @refarm.dev/refarm run build` };
	}

	const result = spawnSync(process.execPath, [cli, "model", "env", "--shell", "--include-secrets"], {
		env: { ...process.env, SILO_HOME: siloHome },
		encoding: "utf8",
		timeout: 10_000,
	});

	if (result.error) {
		return { entries: {}, reason: `refarm model env --shell failed to run: ${result.error.message}` };
	}
	if (result.status !== 0) {
		return { entries: {}, reason: `refarm model env --shell exited ${result.status}: ${result.stderr?.trim()}` };
	}

	try {
		return { entries: parseShellExports(result.stdout) };
	} catch (err) {
		// parseShellExports refuses (throws) rather than silently truncating a malformed
		// value — this function's own contract is "never throws, degrade instead", so that
		// refusal becomes a reason here, same as every other failure mode above.
		return { entries: {}, reason: err.message };
	}
}

/**
 * Start the sandbox daemon.
 *
 * Task 2 defaults: `plugin` defaults to `sandboxAgentPluginPath(repoRoot)` (the working
 * tree's freshly-built agent — see this file's header for why), and `credentials`
 * defaults to `true` (copy the minimum credential set and resolve it into the child's env
 * before spawning). Pass `plugin: null` for no plugin (Task 1's original behavior) or
 * `credentials: false` to skip credential resolution (e.g. a caller that only needs the
 * graph axis, or a test that must not touch `~/.silo`). Neither degrades to a thrown error
 * on its own missing prerequisite (no source identity.json, no built CLI) — see
 * `copySandboxCredentials`/`resolveSandboxModelEnv`'s own contracts — because a sandbox
 * with no model access is still useful for non-model work; it is reported, not hidden.
 *
 * Mirrors scripts/tractor-start.sh's directory-prep + `--refarm-dir` shape and its
 * `model env --shell --include-secrets` credential step, without its plugin-catalog/
 * trusted-plugins composition machinery — out of scope here (this launcher loads exactly
 * one plugin, chosen above, not a resolved set).
 *
 * Refuses (throws) rather than starting if EITHER declared port is occupied — relocating
 * one port while colliding on the other is not isolation (the plan's Global Constraints).
 *
 * Returns the metadata a caller needs to observe/stop what was started; never resolves
 * silently past a state the caller cannot act on.
 */
export async function startSandbox({
	repoRoot = REPO_ROOT,
	background = false,
	extraArgs = [],
	plugin = sandboxAgentPluginPath(repoRoot),
	credentials = true,
} = {}) {
	// Checked FIRST, before any port check/mkdir/spawn — a caller trying to override a
	// safety-critical flag must be refused before this function does anything observable,
	// not after it has already probed ports or touched the filesystem.
	assertNoReservedFlags(extraArgs);

	const { env: sandboxEnv, port, httpPort, namespace } = sandboxEnvironment(repoRoot);
	const sandboxBase = sandboxEnv.SOVEREIGN_BASE;

	const [wsFree, httpFree] = await Promise.all([isPortFree(port), isPortFree(httpPort)]);
	if (!wsFree) {
		throw new Error(
			`sandbox WS port ${port} is already bound — refusing to start ` +
				"(both ports must be free, not just one; see 'ss -ltn')",
		);
	}
	if (!httpFree) {
		throw new Error(
			`sandbox HTTP port ${httpPort} is already bound — refusing to start ` +
				"(both ports must be free, not just one; see 'ss -ltn')",
		);
	}

	const tractor = tractorBinaryPath(repoRoot);
	if (!fs.existsSync(tractor)) {
		throw new Error(
			`tractor binary not found at ${tractor} — build it: ` +
				"cargo build --manifest-path packages/tractor/Cargo.toml --release",
		);
	}

	fs.mkdirSync(sandboxEnv.REFARM_HOME, { recursive: true });
	fs.mkdirSync(sandboxEnv.XDG_DATA_HOME, { recursive: true });

	// `--plugin` is Vec<PathBuf> in packages/tractor/src/main.rs ("may be repeated"), so
	// clap-derive APPENDS every occurrence rather than letting a later one replace an
	// earlier one — appending the default AND a caller-supplied --plugin would load BOTH
	// (and register both for events), not let the caller's win. resolveDefaultPluginArgs
	// skips the default entirely when extraArgs already names one, so the caller's choice
	// is the ONLY plugin loaded.
	const { pluginArgs, notice: pluginNotice } = resolveDefaultPluginArgs(plugin, extraArgs);
	const notices = [];
	if (pluginNotice) notices.push(pluginNotice);

	const args = [
		"--port",
		String(port),
		"--http-port",
		String(httpPort),
		"--namespace",
		namespace,
		"--refarm-dir",
		sandboxEnv.REFARM_HOME,
		...pluginArgs,
		...extraArgs,
	];

	// Computed from the FINAL assembled `args`, not from a separate belief about what was
	// added above — so what this function REPORTS loading can never drift from what it
	// actually passes to spawn() (the exact gap that let a caller-supplied --plugin load
	// silently alongside the default: the printed line only ever showed the default).
	const loadedPlugins = pluginLoadersIn(args);

	// Every axis, in the child's own environment too — so anything the daemon itself reads
	// from env (and any tool later invoked against this same env) resolves identically to
	// what was just declared, never a partial subset of it.
	const childEnv = { ...process.env, ...sandboxEnv };

	let credentialNotice;
	if (credentials) {
		const copyResult = copySandboxCredentials(repoRoot);
		if (!copyResult.copied) {
			credentialNotice = `no credentials copied — ${copyResult.reason}. Model routes fall back to the keyless default.`;
		} else {
			const modelEnv = resolveSandboxModelEnv(repoRoot, { siloHome: sandboxEnv.SILO_HOME });
			if (Object.keys(modelEnv.entries).length === 0 && modelEnv.reason) {
				credentialNotice = `credentials copied but env resolution failed — ${modelEnv.reason}`;
			} else {
				Object.assign(childEnv, modelEnv.entries);
			}
		}
	}
	if (credentialNotice) notices.push(credentialNotice);

	if (background) {
		const logFile = path.join(sandboxBase, "tractor-sandbox.log");
		const pidFile = path.join(sandboxBase, "tractor-sandbox.pid");
		const logFd = fs.openSync(logFile, "a");
		const child = spawn(tractor, args, {
			env: childEnv,
			detached: true,
			stdio: ["ignore", logFd, logFd],
		});

		// Wait for confirmation the process actually spawned before writing the pid file or
		// reporting success. Without this, a spawn failure AFTER the existsSync precheck above
		// (permission denied, ENOEXEC, the binary rebuilt in the gap between check and exec)
		// surfaces only as an unhandled 'error' event — and with no listener attached,
		// `child.pid` is `undefined`, which `String(undefined)` would have written into the pid
		// file as the literal text "undefined" while the CLI printed a success block for a
		// daemon that never started. `'spawn'` (Node >=15.1.0) and `'error'` are mutually
		// exclusive for a given child, so racing them here is exhaustive, not a heuristic.
		const spawnFailure = await new Promise((resolveOutcome) => {
			child.once("spawn", () => resolveOutcome(null));
			child.once("error", (err) => resolveOutcome(err));
		});
		if (spawnFailure) {
			throw new Error(`sandbox daemon failed to start: ${spawnFailure.message}`);
		}

		child.unref();
		fs.writeFileSync(pidFile, String(child.pid));
		return {
			pid: child.pid,
			port,
			httpPort,
			namespace,
			refarmHome: sandboxEnv.REFARM_HOME,
			xdgDataHome: sandboxEnv.XDG_DATA_HOME,
			pidFile,
			logFile,
			plugins: loadedPlugins,
			notices,
		};
	}

	return new Promise((resolveExit, rejectExit) => {
		const child = spawn(tractor, args, { env: childEnv, stdio: "inherit" });
		child.on("error", rejectExit);
		child.on("exit", (code) => {
			resolveExit({
				pid: child.pid,
				exitCode: code,
				port,
				httpPort,
				namespace,
				refarmHome: sandboxEnv.REFARM_HOME,
				xdgDataHome: sandboxEnv.XDG_DATA_HOME,
				plugins: loadedPlugins,
				notices,
			});
		});
	});
}

// ---- CLI entry point ----

async function main() {
	const argv = process.argv.slice(2);
	const background = argv.includes("--background");
	const positional = argv.filter((a) => a !== "--background");
	const command = positional[0] ?? "start";

	if (command !== "start") {
		console.error(
			`refarm-sandbox: unknown command "${command}". Only "start" is implemented ` +
				"(Task 1) — status/--reset land in Task 3.",
		);
		process.exitCode = 1;
		return;
	}

	try {
		const result = await startSandbox({ background, extraArgs: positional.slice(1) });
		console.log("   Sandbox node");
		console.log(`   pid       : ${result.pid}`);
		console.log(`   ws port   : ${result.port}`);
		console.log(`   http port : ${result.httpPort}`);
		console.log(`   namespace : ${result.namespace}`);
		console.log(`   refarm-dir: ${result.refarmHome}`);
		console.log(`   graph dir : ${result.xdgDataHome}`);
		if (result.plugins.length === 0) {
			console.log("   plugin    : <none>");
		} else {
			console.log(`   plugin    : ${result.plugins[0]}`);
			for (const extra of result.plugins.slice(1)) {
				console.log(`             + ${extra}`);
			}
		}
		if (background) {
			console.log(`   log       : ${result.logFile}`);
			console.log(`   pid file  : ${result.pidFile}`);
		}
		// Degraded-start notices (no credentials copied, no plugin found, …) go to STDERR,
		// never stdout — and flip the exit code, so a caller checking `$?` alone (not
		// parsing `notices`) can still tell "started, but not what you asked for" apart
		// from a clean start. A lab that silently comes up without its credentials is the
		// thing this whole plan exists to prevent; an exit code that hides that is the same
		// failure mode as the SILO_HOME/plugin-append gaps this task closed.
		if ((result.notices ?? []).length > 0) {
			for (const notice of result.notices) {
				console.error(`   ⚠  ${notice}`);
			}
			process.exitCode = 2;
		}
	} catch (err) {
		console.error(`   refarm-sandbox: ${err.message}`);
		process.exitCode = 1;
	}
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
	await main();
}
