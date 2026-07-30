/**
 * THE REFUSAL BOUNDARY, ENFORCED FOR THE WHOLE CLI.
 *
 * `refarm intention check --json` with no `--scope` printed a raw Node stack trace and
 * ignored `--json` entirely: a JSON consumer got a crash on stderr and no envelope
 * (fixed in 0534737b). That was the fourth instance of the same class in one session.
 * Fixing instances is not the answer — nothing in the repo FORCED the boundary, which is
 * why each one shipped green. This file is that force.
 *
 * ── The contract ────────────────────────────────────────────────────────────────
 * An invocation with invalid or insufficient input must REFUSE, never crash:
 *   1. it RESOLVES — no uncaught exception escapes `parseAsync`;
 *   2. NO STACK TRACE reaches the operator (no `    at ` frames on stdout or stderr);
 *   3. a non-zero exit is signalled (`process.exitCode`, `process.exit(n)`, or
 *      Commander's own `CommanderError`);
 *   4. under `--json`, stdout carries a parseable envelope — and when it reports
 *      failure, `ok: false` with the `nextCommand`/`nextCommands` handoff fields, the
 *      shape `commands/connection.ts` and `commands/intention.ts` produce.
 *
 * TWO outcomes are acceptable and are DISTINGUISHED, never conflated:
 *   - `commander-usage` — a `CommanderError` from a missing required argument or an
 *     unknown option. Commander printing usage is a refusal, and a good one.
 *   - `refusal-envelope` — the repo's own refusal, reached because the action ran and
 *     validated its input.
 * The third thing — a raw exception or a stack trace — is never acceptable.
 *
 * ── Discovery ───────────────────────────────────────────────────────────────────
 * Commands come from `program` itself, walked recursively (see `discoverCommands`).
 * A hand-maintained list is exactly what fails to catch the NEXT command, so there
 * isn't one: a command added to `program.ts` is probed on the next run, for free.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────────
 * Probing every registered command means RUNNING actions. That is only acceptable
 * because the effect surface is closed first — see `SANDBOX` below and the guards
 * under "side-effect containment". Nothing here may touch the operator's real state.
 */

import { CommanderError, type Command } from "commander";
import realChildProcess from "node:child_process";
import realFs from "node:fs";
import realDgram from "node:dgram";
import realNet from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────────
// SIDE-EFFECT CONTAINMENT
//
// Layer 0 (hoisted, before ANY module of the program graph is imported): a throwaway
// HOME and cwd under the OS temp dir. `os.homedir()` reads `$HOME` on POSIX, and every
// sovereign path in this repo is derived from `$HOME`/`SOVEREIGN_DIR` or from cwd, so
// this alone redirects the whole config/state surface away from the operator's real
// `~/.refarm` and away from the repo working tree.
// ─────────────────────────────────────────────────────────────────────────────────

const SANDBOX = await vi.hoisted(async () => {
	const os = await import("node:os");
	const fs = await import("node:fs");
	const nodePath = await import("node:path");

	const tmpRoot = fs.realpathSync(os.tmpdir());
	const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(tmpRoot, "refarm-refusal-")));
	const home = nodePath.join(root, "home");
	const cwd = nodePath.join(root, "cwd");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(cwd, { recursive: true });

	const ENV_KEYS = [
		"HOME",
		"USERPROFILE",
		"REFARM_HOME",
		"XDG_CONFIG_HOME",
		"XDG_DATA_HOME",
		"XDG_CACHE_HOME",
		"XDG_STATE_HOME",
	] as const;
	const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	const originalCwd = process.cwd();

	for (const key of ENV_KEYS) process.env[key] = home;
	// The app's own boot (src/index.ts) injects this; the vitest setup file stands in for
	// it. Re-assert it here so the sandbox is self-contained if that ever changes.
	process.env.SOVEREIGN_DIR ||= ".refarm";
	process.chdir(cwd);

	return { root, home, cwd, tmpRoot, originalEnv, originalCwd, envKeys: ENV_KEYS };
});

/** Writable only inside the throwaway tree (and the OS temp dir it lives in). A write
 *  anywhere else is a bug in this harness, not in the command — it fails loudly rather
 *  than silently landing in the operator's home or in the repo. */
function isWritablePath(target: unknown): boolean {
	if (typeof target !== "string" && !(target instanceof URL) && !Buffer.isBuffer(target)) {
		// A numeric fd. The `open`/`createWriteStream` that produced it was already gated,
		// so there is no path left to check here.
		return true;
	}
	const value =
		target instanceof URL ? target.pathname : Buffer.isBuffer(target) ? target.toString() : target;
	const resolved = path.resolve(process.cwd(), value);
	return resolved === SANDBOX.tmpRoot || resolved.startsWith(`${SANDBOX.tmpRoot}${path.sep}`);
}

function sandboxEscape(operation: string, target: unknown): Error {
	const error = new Error(
		`refusal-conformance sandbox: fs.${operation} refused outside ${SANDBOX.tmpRoot} (${String(target)})`,
	);
	error.name = "SandboxEscape";
	return Object.assign(error, { code: "EACCES" });
}

/**
 * fs entry points that CREATE OR MUTATE something, each guarded in both its callback
 * and `Sync` form. Reads are untouched — a command reading the real filesystem is
 * harmless and keeps the probe realistic.
 *
 * Declared inside a function, not as a module const: the `vi.mock` factory below runs
 * during the file's very first import, before any module-level `const` is initialised.
 */
function guardedFsNames(): string[] {
	const operations = [
		"writeFile",
		"appendFile",
		"mkdir",
		"mkdtemp",
		"rm",
		"rmdir",
		"unlink",
		"rename",
		"copyFile",
		"cp",
		"truncate",
		"chmod",
		"chown",
		"lchmod",
		"lchown",
		"symlink",
		"link",
		"utimes",
		"lutimes",
		"open",
		"writev",
		"createWriteStream",
	];
	return operations.flatMap((operation) => [operation, `${operation}Sync`]);
}

/** Wrap every write entry point on an fs-like module object. Returns the same object
 *  shape with guarded functions; anything absent is skipped. */
function guardFsLike<T extends Record<string, unknown>>(source: T): T {
	const guarded: Record<string, unknown> = { ...source };
	for (const name of guardedFsNames()) {
		const original = source[name];
		if (typeof original !== "function") continue;
		guarded[name] = (...args: unknown[]) => {
			// `rename`/`copyFile`/`cp`/`link`/`symlink` take a destination too — check both.
			const targets = name.startsWith("symlink") ? args.slice(1, 2) : args.slice(0, 2);
			for (const target of targets) {
				if (typeof target !== "string" && !(target instanceof URL)) continue;
				if (!isWritablePath(target)) throw sandboxEscape(name, target);
			}
			return (original as (...a: unknown[]) => unknown)(...args);
		};
	}
	return guarded as T;
}

// Layer 1: the write guard, applied to the transformed module graph (the app and every
// workspace package, which vitest inlines) …
vi.mock("node:fs", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs")>();
	const guarded = guardFsLike(real as unknown as Record<string, unknown>);
	guarded.promises = guardFsLike((real.promises ?? {}) as unknown as Record<string, unknown>);
	return { ...guarded, default: guarded };
});
vi.mock("node:fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs/promises")>();
	const guarded = guardFsLike(real as unknown as Record<string, unknown>);
	return { ...guarded, default: guarded };
});

// Layer 2: no process ever spawns. `test/architecture/process-boundary.test.ts` already
// forbids `apps/refarm/src` from importing `node:child_process` directly — every spawn
// goes through `@refarm.dev/process-handoff`, which imports it here. Rather than throw
// (an artificial failure the CLI was never asked to survive), the mock behaves like a
// machine where the binary is missing: the realistic, already-handled ENOENT.
vi.mock("node:child_process", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:child_process")>();
	const { EventEmitter } = await import("node:events");
	const { Readable, Writable } = await import("node:stream");
	const enoent = (command: unknown) =>
		Object.assign(new Error(`spawn ${String(command)} ENOENT`), { code: "ENOENT", errno: -2 });

	/** Faithful to what Node really hands back when the binary is not on PATH: a live
	 *  ChildProcess whose streams end empty, then `error` followed by `close` with 127.
	 *  Faithful matters — a crude stub would manufacture failures the CLI was never
	 *  asked to survive, and the harness would report harness bugs as command bugs. */
	function deadSpawn(command: unknown) {
		const child = new EventEmitter() as InstanceType<typeof EventEmitter> &
			Record<string, unknown>;
		child.stdout = Readable.from([]);
		child.stderr = Readable.from([]);
		child.stdin = new Writable({
			write(_chunk, _encoding, done) {
				done();
			},
		});
		child.pid = undefined;
		child.exitCode = null;
		child.killed = false;
		child.kill = () => true;
		child.unref = () => child;
		child.ref = () => child;
		queueMicrotask(() => {
			// EventEmitter throws an uncaught error when `error` has no listener; a caller
			// that only watches `close` gets the exit code instead, exactly as it would
			// from a real failed spawn.
			if (child.listenerCount("error") > 0) child.emit("error", enoent(command));
			child.emit("exit", 127, null);
			child.emit("close", 127, null);
		});
		return child;
	}
	function deadSpawnSync(command: unknown) {
		return {
			pid: 0,
			status: null,
			signal: null,
			output: [null, "", ""],
			stdout: "",
			stderr: "",
			error: enoent(command),
		};
	}
	const patched = {
		...real,
		spawn: deadSpawn,
		fork: deadSpawn,
		exec: deadSpawn,
		execFile: deadSpawn,
		spawnSync: deadSpawnSync,
		execSync: (command: unknown) => {
			throw enoent(command);
		},
		execFileSync: (command: unknown) => {
			throw enoent(command);
		},
	};
	return { ...patched, default: patched };
});

// Layer 3: no socket ever binds or connects. These are PROTOTYPE patches on the real
// modules rather than module mocks, so they hold for every caller in the process —
// inlined workspace code, externalised node_modules, and anything reaching `node:http`
// (whose Server extends `net.Server`) alike. A listening port is the one effect a
// sandboxed HOME and cwd cannot contain, and the operator has `refarm web serve` live
// on 4321 that this must never contend with.
const SOCKET_GUARDS = (() => {
	const refuse = (what: string) => () => {
		throw new Error(`refusal-conformance sandbox: ${what} refused`);
	};
	const originals = {
		listen: realNet.Server.prototype.listen,
		connect: realNet.Socket.prototype.connect,
		bind: realDgram.Socket.prototype.bind,
	};
	realNet.Server.prototype.listen = refuse("net.Server#listen") as never;
	realNet.Socket.prototype.connect = refuse("net.Socket#connect") as never;
	realDgram.Socket.prototype.bind = refuse("dgram.Socket#bind") as never;
	return originals;
})();

// Layer 4: no network request leaves the process. A rejected fetch is exactly what the
// CLI already sees when the runtime is down — the realistic failure, not an artificial
// one — so `reportSidecarError` and friends are exercised rather than bypassed.
const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
	throw Object.assign(new Error("fetch failed"), {
		cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
		refusalConformanceTarget: String(input),
	});
}) as typeof fetch;

// ─────────────────────────────────────────────────────────────────────────────────
// The program under probe. Imported AFTER the hoisted sandbox and the mocks above,
// so nothing in its module graph can see the operator's real HOME or cwd.
// ─────────────────────────────────────────────────────────────────────────────────
const { program } = await import("../../src/program.js");

// ─────────────────────────────────────────────────────────────────────────────────
// EXCLUSIONS — a debt, not a solution.
//
// Every entry costs real coverage, so each one names the specific effect that cannot
// be contained in-process, and the list is PRINTED by the first test so it can never
// read as coverage that does not exist. Excluded commands are still probed with the
// unknown-option kind (which Commander refuses before the action ever runs) — the
// exclusion removes only the deep probe that would execute the action.
// ─────────────────────────────────────────────────────────────────────────────────
const DEEP_PROBE_EXCLUSIONS: Record<string, string> = {
	// ── Blocks on a human ────────────────────────────────────────────────────────
	"refarm":
		"the bare root runs runSessionLaunchFlow(): it can autostart the runtime and then blocks on an interactive agent REPL reading stdin, which never returns in a test process.",
	"refarm session":
		"same interactive agent REPL as the bare root (runSessionLaunchFlow) — blocks on stdin.",
	"refarm chat":
		"same interactive agent REPL as the bare root (runSessionLaunchFlow) — blocks on stdin.",
	"refarm sow":
		"interactive credential capture: prompts on stdin for provider keys and would block forever with no TTY.",
	"refarm init":
		"blocks on the interactive template prompt (operator.ask in init.ts); the probe never settles.",
	"refarm migrate":
		"blocks on the interactive target-URL prompt (operator.ask in migrate.ts); the probe never settles.",
	"refarm ask":
		"submits the prompt to the model provider and waits on the runtime; the probe never settles within any sane budget.",

	// ── Binds a listening socket ─────────────────────────────────────────────────
	"refarm serve":
		"binds a listening HTTP port (the capability surface). Listening sockets are the one effect a sandboxed HOME/cwd cannot contain.",
	"refarm web serve":
		"binds a listening HTTP port; the operator has `refarm web serve` live on 4321 and this must never contend with it.",

	// ── Reaches the REAL operator state regardless of cwd ────────────────────────
	// findRepoRoot() resolves the repository from the module's own location, not from
	// process.cwd(), so a sandboxed cwd does NOT redirect these. The fs write guard
	// caught every one of them reaching for the operator's live `.refarm/`.
	"refarm discover announce":
		"writes and removes .refarm/farm-announce.pid under the REAL repo root (resolved from module location, not cwd) — the sandbox cannot redirect it.",
	"refarm runtime start":
		"creates the REAL repo's .refarm/ and launches the runtime; the operator's runtime is live and must not be touched.",
	"refarm runtime ensure":
		"creates the REAL repo's .refarm/ and can launch the runtime; the operator's runtime is live and must not be touched.",
	"refarm runtime restart":
		"creates the REAL repo's .refarm/ and restarts the runtime; the operator's runtime is live and must not be touched.",
	"refarm runtime stop":
		"reads the REAL repo's .refarm pidfile and process.kill()s that pid — it would stop the operator's live runtime. Only the harness's process.kill guard stood between the probe and that.",
};

/**
 * KNOWN DEFECTS — commands that fail the contract today, quarantined by their EXACT
 * violation codes so the ratchet only turns one way.
 *
 * This is not a mute button. The assertion is equality, not "at most": a new violation
 * on a quarantined command still fails, and FIXING one also fails (with a message
 * telling you to delete the entry). It cannot rot into permanent cover.
 *
 * Found by the first run of this harness against 163 discovered commands. The list is
 * for triage with the operator — several entries are genuine design questions (should
 * `runtime status --json` exit non-zero when the runtime is simply not running?) rather
 * than mechanical fixes, and guessing at those would be worse than naming them.
 */
const KNOWN_DEFECTS: Record<string, { codes: ViolationCode[]; note: string }> = {
	"refarm guide": {
		codes: ["ok-false-exit-zero"],
		note: "prints an ok:false envelope but exits 0 — `refarm guide --json && …` reads as success.",
	},
	"refarm agent doctor": {
		codes: ["ok-false-exit-zero"],
		note: "prints an ok:false envelope but exits 0.",
	},
	"refarm runtime": {
		codes: ["ok-false-exit-zero"],
		note: "prints an ok:false envelope but exits 0. Triage: is 'runtime not running' an error or a state?",
	},
	"refarm runtime status": {
		codes: ["ok-false-exit-zero"],
		note: "prints an ok:false envelope but exits 0. Triage: is 'runtime not running' an error or a state?",
	},
};

// ─────────────────────────────────────────────────────────────────────────────────
// DISCOVERY — from the program, never from a list.
// ─────────────────────────────────────────────────────────────────────────────────

interface DiscoveredCommand {
	/** Human-facing invocation, e.g. `refarm intention check`. */
	label: string;
	/** argv path from the root, e.g. `["intention", "check"]`. */
	argvPath: string[];
	/** Names of the arguments Commander will refuse to run without. */
	requiredArgs: string[];
	hasJsonOption: boolean;
}

interface CommanderArgumentLike {
	name(): string;
	required: boolean;
}

function commandArguments(command: Command): CommanderArgumentLike[] {
	const withInternals = command as unknown as {
		registeredArguments?: CommanderArgumentLike[];
		_args?: CommanderArgumentLike[];
	};
	return withInternals.registeredArguments ?? withInternals._args ?? [];
}

function hasActionHandler(command: Command): boolean {
	return typeof (command as unknown as { _actionHandler?: unknown })._actionHandler === "function";
}

export function discoverCommands(root: Command): DiscoveredCommand[] {
	const found: DiscoveredCommand[] = [];
	const walk = (command: Command, argvPath: string[]): void => {
		if (hasActionHandler(command)) {
			found.push({
				label: ["refarm", ...argvPath].join(" "),
				argvPath,
				requiredArgs: commandArguments(command)
					.filter((argument) => argument.required)
					.map((argument) => argument.name()),
				hasJsonOption: command.options.some((option) => option.long === "--json"),
			});
		}
		for (const child of command.commands) walk(child, [...argvPath, child.name()]);
	};
	walk(root, []);
	return found;
}

/** Commander must never be able to kill the test process, and its output must be
 *  captured rather than printed. Both settings are copied to subcommands at CREATION
 *  time, so an already-built tree needs them applied node by node. */
function instrumentTree(root: Command, sink: { stdout: string[]; stderr: string[] }): void {
	const visit = (command: Command): void => {
		command.exitOverride();
		command.configureOutput({
			writeOut: (text) => sink.stdout.push(text),
			writeErr: (text) => sink.stderr.push(text),
		});
		for (const child of command.commands) visit(child);
	};
	visit(root);
}

// ─────────────────────────────────────────────────────────────────────────────────
// PROBING
// ─────────────────────────────────────────────────────────────────────────────────

/** A value that cannot name anything real: no plugin, no session, no file, no host. */
const SENTINEL = "__refarm_refusal_conformance_probe__";
const UNKNOWN_FLAG = "--refarm-refusal-conformance-unknown-flag";
const PROBE_TIMEOUT_MS = 4_000;

type ProbeKind = "unknown-option" | "missing-required" | "garbage-input";

interface ProbeResult {
	kind: ProbeKind;
	argv: string[];
	json: boolean;
	/** Anything that escaped `parseAsync` and was NOT a `CommanderError`. */
	escaped: unknown;
	commanderError: CommanderError | undefined;
	exitSignal: number | undefined;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

class ProcessExitCalled extends Error {
	constructor(readonly exitCode: number) {
		super(`process.exit(${exitCode})`);
	}
}

const ANSI = /\[[0-9;]*m/g;

async function probe(
	root: Command,
	argv: string[],
	kind: ProbeKind,
	json: boolean,
): Promise<ProbeResult> {
	const sink = { stdout: [] as string[], stderr: [] as string[] };
	instrumentTree(root, sink);

	const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => void sink.stdout.push(a.join(" ")));
	const infoSpy = vi.spyOn(console, "info").mockImplementation((...a) => void sink.stdout.push(a.join(" ")));
	const errSpy = vi.spyOn(console, "error").mockImplementation((...a) => void sink.stderr.push(a.join(" ")));
	const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => void sink.stderr.push(a.join(" ")));
	const outSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: unknown) => (sink.stdout.push(String(chunk)), true));
	const errWriteSpy = vi
		.spyOn(process.stderr, "write")
		.mockImplementation((chunk: unknown) => (sink.stderr.push(String(chunk)), true));
	// A command must never take the process down with it, and must never signal a
	// process outside the sandbox.
	const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
		throw new ProcessExitCalled(typeof code === "number" ? code : 0);
	}) as never);
	const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
		throw new Error("refusal-conformance sandbox: process.kill refused");
	}) as never);

	process.exitCode = undefined;

	let escaped: unknown;
	let commanderError: CommanderError | undefined;
	let exitSignal: number | undefined;
	let timedOut = false;

	try {
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), PROBE_TIMEOUT_MS);
			timer.unref?.();
		});
		const outcome = await Promise.race([
			root.parseAsync(argv, { from: "user" }).then(() => "done" as const),
			timeout,
		]);
		if (timer) clearTimeout(timer);
		timedOut = outcome === "timeout";
	} catch (error) {
		if (error instanceof CommanderError) commanderError = error;
		else if (error instanceof ProcessExitCalled) exitSignal = error.exitCode;
		else escaped = error;
	}

	if (exitSignal === undefined) {
		exitSignal =
			commanderError !== undefined
				? commanderError.exitCode
				: typeof process.exitCode === "number"
					? process.exitCode
					: undefined;
	}
	process.exitCode = undefined;

	for (const spy of [logSpy, infoSpy, errSpy, warnSpy, outSpy, errWriteSpy, exitSpy, killSpy]) {
		spy.mockRestore();
	}

	return {
		kind,
		argv,
		json,
		escaped,
		commanderError,
		exitSignal,
		stdout: sink.stdout.join("\n").replace(ANSI, ""),
		stderr: sink.stderr.join("\n").replace(ANSI, ""),
		timedOut,
	};
}

/** `    at Object.<anonymous> (/path:1:2)` — the shape a raw Node throw leaves behind.
 *  This is the single thing the operator must never see. */
const STACK_FRAME = /^\s+at\s+\S/m;

/** The closed set of ways an invocation can break the contract. Stable identifiers:
 *  `KNOWN_DEFECTS` quarantines against these, so a defect is pinned, never muted. */
type ViolationCode =
	| "unprobeable-timeout"
	| "sandbox-escape"
	| "escaped-exception"
	| "stack-trace"
	| "commander-exit-zero"
	| "accepted-invalid-input"
	| "json-no-envelope"
	| "envelope-no-next-command"
	| "envelope-no-next-commands"
	| "ok-false-exit-zero";

interface Violation {
	code: ViolationCode;
	message: string;
}

function violationCodes(violations: Violation[]): ViolationCode[] {
	return [...new Set(violations.map((violation) => violation.code))].sort();
}

function parseEnvelope(stdout: string): Record<string, unknown> | undefined {
	const direct = stdout.trim();
	const candidates = [direct];
	const first = direct.indexOf("{");
	const last = direct.lastIndexOf("}");
	if (first >= 0 && last > first) candidates.push(direct.slice(first, last + 1));
	for (const candidate of candidates) {
		try {
			const value: unknown = JSON.parse(candidate);
			if (value && typeof value === "object" && !Array.isArray(value)) {
				return value as Record<string, unknown>;
			}
		} catch {
			// try the next candidate
		}
	}
	return undefined;
}

/**
 * Judge one probe against the contract. An empty array is a pass.
 *
 * Each violation carries a stable CODE as well as its operator-readable message: the
 * code is what `KNOWN_DEFECTS` quarantines against, so a quarantine entry pins the
 * exact defect rather than muting a whole command.
 *
 * The two acceptable outcomes are distinguished here, never conflated: a
 * `CommanderError` short-circuits the envelope requirements, because Commander printed
 * usage and the action never ran.
 */
export function violationsFor(result: ProbeResult): Violation[] {
	const violations: Violation[] = [];
	const shown = `\`${["refarm", ...result.argv].join(" ")}\` [${result.kind}]`;
	const add = (code: ViolationCode, detail: string) =>
		violations.push({ code, message: `${shown}: ${detail}` });

	if (result.timedOut) {
		add("unprobeable-timeout", `did not settle within ${PROBE_TIMEOUT_MS}ms — unprobeable`);
		return violations;
	}

	if (result.escaped !== undefined) {
		const error = result.escaped;
		const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		// Distinguish a CONTAINMENT stop from a refusal defect. A SandboxEscape means the
		// command reached for real state the sandbox refuses to give it — that is the
		// harness protecting the operator, and it means the command needs an exclusion
		// with a reason, NOT that its refusal boundary is broken.
		if (error instanceof Error && error.name === "SandboxEscape") {
			add(
				"sandbox-escape",
				`reached outside the sandbox for real operator state — unprobeable here (${error.message})`,
			);
		} else {
			add("escaped-exception", `an exception escaped parseAsync — ${detail}`);
		}
	}

	if (STACK_FRAME.test(result.stderr)) add("stack-trace", "a stack trace reached stderr");
	if (STACK_FRAME.test(result.stdout)) add("stack-trace", "a stack trace reached stdout");

	// Commander's own usage error IS a refusal. Nothing below applies to it.
	if (result.commanderError) {
		if (result.commanderError.exitCode === 0) {
			add("commander-exit-zero", "Commander refused but signalled exit 0");
		}
		return violations;
	}

	const failed = result.exitSignal !== undefined && result.exitSignal !== 0;

	if (result.kind !== "garbage-input" && !failed && result.escaped === undefined) {
		add(
			"accepted-invalid-input",
			"input Commander must reject was accepted — no non-zero exit was signalled",
		);
	}

	if (result.json) {
		const envelope = parseEnvelope(result.stdout);
		if (failed && !envelope) {
			add(
				"json-no-envelope",
				`exited ${result.exitSignal} under --json with no parseable envelope on stdout`,
			);
		}
		if (envelope && envelope.ok === false) {
			if (!("nextCommand" in envelope)) {
				add("envelope-no-next-command", "ok:false envelope has no nextCommand handoff field");
			}
			if (!Array.isArray(envelope.nextCommands)) {
				add("envelope-no-next-commands", "ok:false envelope has no nextCommands array");
			}
			if (!failed) {
				add("ok-false-exit-zero", "printed ok:false but signalled exit 0");
			}
		}
	}

	return violations;
}

async function probeCommand(root: Command, command: DiscoveredCommand): Promise<Violation[]> {
	const violations: Violation[] = [];

	// (a) Unknown option — definitionally invalid for EVERY command, and Commander
	//     rejects it before the action runs, so it is safe even for the exclusions.
	violations.push(
		...violationsFor(
			await probe(root, [...command.argvPath, UNKNOWN_FLAG], "unknown-option", false),
		),
	);

	if (DEEP_PROBE_EXCLUSIONS[command.label] !== undefined) return violations;

	// (b) Missing required arguments — insufficient input. The action never runs.
	if (command.requiredArgs.length > 0) {
		const argv = command.hasJsonOption ? [...command.argvPath, "--json"] : [...command.argvPath];
		violations.push(...violationsFor(await probe(root, argv, "missing-required", command.hasJsonOption)));
	}

	// (c) Garbage input — the deep probe. Required arguments are filled with a sentinel
	//     that cannot name anything real, so the action RUNS and its own validation is
	//     what has to refuse. This is the probe that finds the intention-class defect.
	const garbage = [...command.argvPath, ...command.requiredArgs.map(() => SENTINEL)];
	violations.push(...violationsFor(await probe(root, garbage, "garbage-input", false)));
	if (command.hasJsonOption) {
		violations.push(
			...violationsFor(await probe(root, [...garbage, "--json"], "garbage-input", true)),
		);
	}

	return violations;
}

// ─────────────────────────────────────────────────────────────────────────────────
// THE SUITE
// ─────────────────────────────────────────────────────────────────────────────────

const COMMANDS = discoverCommands(program);

describe("CLI refusal conformance", () => {
	beforeEach(() => {
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	afterAll(() => {
		globalThis.fetch = ORIGINAL_FETCH;
		realNet.Server.prototype.listen = SOCKET_GUARDS.listen;
		realNet.Socket.prototype.connect = SOCKET_GUARDS.connect;
		realDgram.Socket.prototype.bind = SOCKET_GUARDS.bind;
		process.chdir(SANDBOX.originalCwd);
		for (const key of SANDBOX.envKeys) {
			const original = SANDBOX.originalEnv[key];
			if (original === undefined) delete process.env[key];
			else process.env[key] = original;
		}
		realFs.rmSync(SANDBOX.root, { recursive: true, force: true });
	});

	it("discovers every registered command from the program, not from a list", () => {
		// A guard against the discovery silently going to zero (a refactor of program.ts,
		// a lazy-loading change) and the whole suite passing vacuously.
		expect(COMMANDS.length).toBeGreaterThan(100);
		expect(COMMANDS.map((command) => command.label)).toContain("refarm intention check");
		expect(COMMANDS.map((command) => command.label)).toContain("refarm connection status");
	});

	it("names every excluded command and every known defect — neither is a silent skip", () => {
		console.log(
			[
				`CLI refusal conformance — ${COMMANDS.length} commands discovered from the program.`,
				"",
				`${Object.keys(DEEP_PROBE_EXCLUSIONS).length} EXCLUDED from the deep probe (still probed`,
				"with the unknown-option kind, which Commander refuses before the action runs):",
				...Object.entries(DEEP_PROBE_EXCLUSIONS).map(
					([label, reason]) => `  ${label}\n      reason: ${reason}`,
				),
				"",
				`${Object.keys(KNOWN_DEFECTS).length} KNOWN DEFECTS quarantined by exact violation code`,
				"(a new violation still fails; so does fixing one — delete the entry then):",
				...Object.entries(KNOWN_DEFECTS).map(
					([label, defect]) => `  ${label}  [${defect.codes.join(", ")}]\n      ${defect.note}`,
				),
			].join("\n"),
		);
		// Every entry must name a real command, or it is stale cover for nothing.
		const labels = new Set(COMMANDS.map((command) => command.label));
		for (const label of Object.keys(DEEP_PROBE_EXCLUSIONS)) {
			expect(labels, `stale exclusion: ${label} is not a registered command`).toContain(label);
		}
		for (const label of Object.keys(KNOWN_DEFECTS)) {
			expect(labels, `stale known defect: ${label} is not a registered command`).toContain(label);
			expect(
				DEEP_PROBE_EXCLUSIONS[label],
				`${label} is both excluded and quarantined — pick one`,
			).toBeUndefined();
		}
		// A reason, not a shrug.
		for (const reason of Object.values(DEEP_PROBE_EXCLUSIONS)) {
			expect(reason.length).toBeGreaterThan(40);
		}
		for (const defect of Object.values(KNOWN_DEFECTS)) {
			expect(defect.note.length).toBeGreaterThan(20);
			expect(defect.codes.length).toBeGreaterThan(0);
		}
	});

	it("contains every side effect before probing anything", () => {
		expect(process.cwd()).toBe(SANDBOX.cwd);
		expect(process.env.HOME).toBe(SANDBOX.home);
		// The write guard is live on the fs the program graph sees.
		expect(() => realFs.writeFileSync(path.join(SANDBOX.originalCwd, "escape.txt"), "x")).toThrow(
			/sandbox/,
		);
		expect(() => realFs.mkdirSync(path.join(SANDBOX.originalCwd, "escape-dir"))).toThrow(/sandbox/);
		// …and writes inside the throwaway tree still work, so a command that legitimately
		// writes state is exercised rather than short-circuited.
		const inside = path.join(SANDBOX.cwd, "allowed.txt");
		realFs.writeFileSync(inside, "ok");
		expect(realFs.readFileSync(inside, "utf-8")).toBe("ok");
		// No process ever spawns.
		expect(realChildProcess.spawnSync("git", ["status"]).error).toBeInstanceOf(Error);
		// No socket ever binds or connects.
		expect(() => realNet.createServer().listen(0)).toThrow(/sandbox/);
		expect(() => realDgram.createSocket("udp4").bind(0)).toThrow(/sandbox/);
	});

	for (const command of COMMANDS) {
		const excluded = DEEP_PROBE_EXCLUSIONS[command.label];
		const known = KNOWN_DEFECTS[command.label];
		const suffix = excluded
			? " (deep probe excluded — see the exclusion list)"
			: known
				? " (known defect, quarantined)"
				: "";
		it(
			`${command.label} — refuses invalid input instead of crashing${suffix}`,
			async () => {
				const violations = await probeCommand(program, command);
				const expected = known?.codes ?? [];
				const detail = [
					...violations.map((violation) => `  ${violation.code}  ${violation.message}`),
					known
						? `\nQuarantined in KNOWN_DEFECTS as [${known.codes.join(", ")}]: ${known.note}\n` +
							"If this command now conforms, DELETE its KNOWN_DEFECTS entry — the ratchet only turns one way."
						: "",
				].join("\n");
				expect(violationCodes(violations), detail).toEqual([...expected].sort());
			},
			30_000,
		);
	}
});

/**
 * The harness must FAIL when a command regresses. A conformance suite that cannot go
 * red is decoration, so this drives the same machinery with a command that violates
 * the contract on purpose. The fixture is never added to `program` — it exists only
 * here, so it can never widen the real CLI's surface.
 */
describe("CLI refusal conformance — the harness itself", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	async function buildFixture(): Promise<Command> {
		const { Command: CommandCtor } = await import("commander");
		const root = new CommandCtor("fixture");
		root
			.command("crashes")
			.option("--json", "Output machine-readable JSON")
			.action(() => {
				// Exactly the shape `intention check --json` had before 0534737b: a bare
				// throw at the action boundary.
				throw new Error("--scope is required");
			});
		root
			.command("swallows")
			.option("--json", "Output machine-readable JSON")
			.action(() => {
				// Fails, says so on stderr, ignores --json: the JSON consumer gets nothing.
				console.error("something went wrong");
				process.exitCode = 1;
			});
		root
			.command("refuses")
			.option("--json", "Output machine-readable JSON")
			.action((options: { json?: boolean }) => {
				if (options.json) {
					console.log(
						JSON.stringify({
							ok: false,
							command: "fixture",
							operation: "refuses",
							error: "fixture-invalid-request",
							message: "--scope is required",
							nextAction: "Run `fixture refuses --help`.",
							nextCommand: "fixture refuses --help",
							nextActions: ["Run `fixture refuses --help`."],
							nextCommands: ["fixture refuses --help"],
						}),
					);
				} else {
					console.error("✗  --scope is required");
				}
				process.exitCode = 1;
			});
		return root;
	}

	it("catches a command that throws out of its action", async () => {
		const fixture = await buildFixture();
		const violations = violationsFor(
			await probe(fixture, ["crashes", "--json"], "garbage-input", true),
		);
		expect(violationCodes(violations)).toContain("escaped-exception");
		expect(violations.map((violation) => violation.message).join("\n")).toMatch(
			/an exception escaped parseAsync/,
		);
	});

	it("catches a command that fails under --json without an envelope", async () => {
		const fixture = await buildFixture();
		const violations = violationsFor(
			await probe(fixture, ["swallows", "--json"], "garbage-input", true),
		);
		expect(violationCodes(violations)).toEqual(["json-no-envelope"]);
	});

	it("passes a command that refuses with the repo's envelope", async () => {
		const fixture = await buildFixture();
		expect(violationsFor(await probe(fixture, ["refuses", "--json"], "garbage-input", true))).toEqual(
			[],
		);
		expect(violationsFor(await probe(fixture, ["refuses"], "garbage-input", false))).toEqual([]);
	});

	it("accepts Commander's own usage error as a refusal", async () => {
		const fixture = await buildFixture();
		const result = await probe(fixture, ["crashes", UNKNOWN_FLAG], "unknown-option", false);
		expect(result.commanderError?.code).toBe("commander.unknownOption");
		expect(violationsFor(result)).toEqual([]);
	});
});
