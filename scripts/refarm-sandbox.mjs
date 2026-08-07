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
 * SCOPE — Task 1 only (.superpowers/sdd/2026-08-06-the-sandbox-node/task-1-brief.md):
 *   - declares the four axes + both ports (`sandboxEnvironment`, PURE)
 *   - starts the sandbox daemon with NO `--plugin` — Task 2 decides, deliberately, which
 *     plugin/credentials the sandbox loads; that choice is not made here.
 *   - does NOT implement `status` or `--reset` (Task 3) or `refarm parity` (Task 5).
 *
 * Does NOT read or modify scripts/tractor-start.sh — the operator's launcher — in any way.
 * This is a separate, independent script for a separate, independent node, deliberately
 * simpler than tractor-start.sh: no model-provider resolution, no plugin-catalog sync, no
 * `.refarm/.env` loading — none of that is reachable from a daemon with no loaded plugin.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
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

	return {
		env: {
			SOVEREIGN_BASE: sandboxBase,
			SOVEREIGN_DIR: SANDBOX_SOVEREIGN_DIR,
			REFARM_HOME: refarmHome,
			// THE GRAPH — does NOT follow REFARM_HOME. storage/sqlite.rs's db_dir() reads
			// XDG_DATA_HOME directly; main.rs never threads REFARM_HOME through to it. Omitting
			// this key is the exact defect this task was written to close.
			XDG_DATA_HOME: xdgDataHome,
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
		const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
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
 * Start the sandbox daemon. Deliberately loads NO `--plugin` (Task 2 decides which
 * plugin/credentials the sandbox uses) and reads no `.refarm/.env` (nothing here calls a
 * model, so there is nothing to authenticate). Mirrors scripts/tractor-start.sh's
 * directory-prep + `--refarm-dir` shape, without its model-provider/plugin-install/catalog
 * machinery — none of that is reachable from a daemon with no loaded plugin, and none of
 * it is in this task's scope.
 *
 * Refuses (throws) rather than starting if EITHER declared port is occupied — relocating
 * one port while colliding on the other is not isolation (the plan's Global Constraints).
 *
 * Returns the metadata a caller needs to observe/stop what was started; never resolves
 * silently past a state the caller cannot act on.
 */
export async function startSandbox({ repoRoot = REPO_ROOT, background = false, extraArgs = [] } = {}) {
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

	const args = [
		"--port",
		String(port),
		"--http-port",
		String(httpPort),
		"--namespace",
		namespace,
		"--refarm-dir",
		sandboxEnv.REFARM_HOME,
		...extraArgs,
	];

	// Every axis, in the child's own environment too — so anything the daemon itself reads
	// from env (and any tool later invoked against this same env) resolves identically to
	// what was just declared, never a partial subset of it.
	const childEnv = { ...process.env, ...sandboxEnv };

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
		if (background) {
			console.log(`   log       : ${result.logFile}`);
			console.log(`   pid file  : ${result.pidFile}`);
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
