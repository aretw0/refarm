/**
 * AN OPTION THE OPERATOR PASSED MUST REACH THE COMMAND THEY INVOKED.
 *
 * Commander 14 files an option on the NEAREST ANCESTOR that declares the same long name — even
 * when the invoked subcommand declares it too, and even when the flag is typed AFTER the
 * subcommand. So `refarm tasks show <id> --json` lands `json` on `tasks`, and `show`'s own
 * `opts()` comes back `{}`. Nothing warns; nothing fails; the command simply runs as though the
 * operator had not typed the flag.
 *
 * Three instances surfaced in ONE DAY, found by three harnesses none of which was looking for it:
 *
 *   1. `refarm tasks show <id> --json`         — never received `--json` at all, so even the
 *                                                SUCCESS path printed prose to a JSON consumer.
 *   2. `refarm config history undo <id> --local` — `history` swallowed `--local`, so the undo ran
 *                                                against the HOME trail instead of the repo one.
 *                                                Silently wrong, on a destructive operation.
 *   3. `refarm cert trust system --json`        — exited 1 with no envelope.
 *
 * Each was fixed in isolation (`hasLocalOption`, `optsWithGlobals()`). Nothing prevented the
 * fourth. This file is that prevention.
 *
 * ── The contract ────────────────────────────────────────────────────────────────────────────
 * For every command with an action, and every option REACHABLE at that command:
 *   if Commander does not file that option into the command's OWN `opts()`, then the command's
 *   action must not read it from its own `opts()` — it must reach the ancestor chain, via
 *   `optsWithGlobals()` or an explicit walk (`hasJsonOption`, `hasLocalOption`, `parent.opts()`).
 *
 * A command with no shadowed option is free to read `opts()`; that is the overwhelming majority,
 * and flagging it would be noise. The rule fires exactly where the read cannot succeed.
 *
 * ── Why both halves, and what each is for ───────────────────────────────────────────────────
 * STRUCTURAL (the oracle). Which options are misfiled is not guessed from a reading of Commander's
 * documentation — it is MEASURED, by parsing a structural MIRROR of the real tree: same command
 * names, same option flags, same positional arity, and nothing else. The mirror carries no action
 * bodies, no argument parsers and no defaults, so parsing it has no effect beyond recording where
 * Commander put each token. Deriving the oracle this way means a Commander upgrade that changes
 * the binding rule re-baselines this harness automatically instead of leaving it asserting a
 * fossil. The mirror is also the only safe way to ask the question for commands the behavioural
 * half must not execute.
 *
 * A source-level rule was considered and rejected as the PRIMARY check. `.action(fn)` can be
 * read back with `fn.toString()`, but half this CLI's actions are wrapped — `guardedAction(…)`,
 * `capabilityAction(…)`, `commandOptions(…)` — and the wrapper's source is all `toString()` can
 * see. A structural check that cannot see through a wrapper would have passed `config history
 * undo` (whose action is a `guardedAction` closure) while it was actively corrupting the wrong
 * trail. What follows sees through every wrapper because it does not read source at all.
 *
 * BEHAVIOURAL (the verdict). The invoked action is RUN, with `Command.prototype.opts` and
 * `optsWithGlobals` instrumented to record which attribute each read came from and WHICH COMMAND
 * in the chain answered it. A read of `json` off the invoked command's own `opts()`, when `json`
 * is misfiled and nothing in the action ever consulted an ancestor for it, is the bug — observed
 * as it happens, wherever in the call graph it happens.
 *
 * The probe passes NO flags. That is deliberate: every correct implementation reads the attribute
 * unconditionally (`opts.json === true`), so the read happens either way — while PASSING the flag
 * can short-circuit the very ancestor walk that proves the defence (`opts.local === true || …`).
 * Not passing it is both cheaper and strictly more sensitive.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────────────────────
 * Running actions is only acceptable because the effect surface is closed first. `vitest.setup.ts`
 * already supplies a throwaway `HOME`/`XDG_*` and an fs write guard suite-wide; this file adds the
 * layers `cli-refusal-conformance.test.ts` established for the same reason — no spawn, no socket,
 * no fetch, no `process.exit`, no `process.kill` — and inherits its exclusion list verbatim, for
 * the same commands and the same reasons. The operator has a live runtime, a live `refarm web
 * serve`, and a live CA under `~/.refarm`; none of them may be touched to make a test green.
 */

import { Command, CommanderError } from "commander";
import realChildProcess from "node:child_process";
import realDgram from "node:dgram";
import realFs from "node:fs";
import realNet from "node:net";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SIDE-EFFECT CONTAINMENT
//
// Layer 0 (HOME/XDG redirect) and the fs write guard are already installed suite-wide by
// `vitest.setup.ts` — see the header there. What follows adds the layers that only matter when a
// test RUNS command actions, copied in shape and in reasoning from
// `cli-refusal-conformance.test.ts`, which is where this pattern was worked out.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// No process ever spawns. `process-boundary.test.ts` already forbids `apps/refarm/src` from
// importing `node:child_process` directly, so every spawn arrives here through
// `@refarm.dev/process-handoff`. The mock behaves like a machine where the binary is missing —
// the realistic, already-handled ENOENT, rather than an artificial throw.
vi.mock("node:child_process", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:child_process")>();
	const { EventEmitter } = await import("node:events");
	const { Readable, Writable } = await import("node:stream");
	const enoent = (command: unknown) =>
		Object.assign(new Error(`spawn ${String(command)} ENOENT`), { code: "ENOENT", errno: -2 });

	function deadSpawn(command: unknown) {
		const child = new EventEmitter() as InstanceType<typeof EventEmitter> & Record<string, unknown>;
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

// No socket ever binds or connects. Prototype patches rather than module mocks, so they hold for
// every caller in the process — a listening port is the one effect a sandboxed HOME cannot
// contain, and the operator has `refarm web serve` live on 4321 that this must never contend with.
const SOCKET_GUARDS = (() => {
	const refuse = (what: string) => () => {
		throw new Error(`ancestor-option sandbox: ${what} refused`);
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

// No network request leaves the process. A rejected fetch is exactly what the CLI already sees
// when the runtime is down, so the recovery paths are exercised rather than bypassed.
const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
	throw Object.assign(new Error("fetch failed"), {
		cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
		ancestorOptionTarget: String(input),
	});
}) as typeof fetch;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE INSTRUMENT — who answered which read.
//
// `Command.prototype.opts()` and `optsWithGlobals()` are patched for the duration of a probe.
// Each returns a Proxy that records every attribute read, tagged by WHERE the answer came from:
//   · `own`      — the invoked command's own `opts()`. A misfiled option is never here.
//   · `ancestor` — some ancestor's `opts()`: an explicit walk (`hasLocalOption`, `parent.opts()`).
//   · `globals`  — the merged object from `optsWithGlobals()`, which sees the whole chain.
//
// The recording is per-attribute rather than per-command, so a command that defends `--json` with
// `optsWithGlobals()` and still reads `--local` off its own `opts()` is caught on `--local` alone.
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Recording {
	target: Command;
	ancestors: Set<Command>;
	own: Set<string>;
	ancestor: Set<string>;
	globals: Set<string>;
}

let RECORDING: Recording | null = null;
/** `optsWithGlobals()` calls `opts()` on every command in the chain and `Object.assign`s the
 *  results. Those internal reads are Commander's, not the action's, and must not be recorded. */
let INSIDE_GLOBALS = 0;

type OptsFn = (this: Command) => Record<string, unknown>;
const REAL_OPTS = Command.prototype.opts as unknown as OptsFn;
const REAL_OPTS_WITH_GLOBALS = Command.prototype.optsWithGlobals as unknown as OptsFn;

/**
 * A WHOLE-OBJECT read: `{...opts}`, `Object.assign({}, opts)`, `Object.keys(opts)`.
 *
 * `refarm agent finish` is why this exists. It defends correctly — `{...command.parent?.opts(),
 * ...command.opts()}` — but a per-attribute recorder sees nothing, because the parent's options
 * object is empty on a probe that passes no flags and a spread of an empty object reads no keys.
 * Recording the enumeration itself captures the intent: a command that enumerates an ANCESTOR's
 * options has consulted the chain for everything that ancestor holds, and a command that
 * enumerates only its OWN has read every one of its attributes and will be missing the misfiled
 * ones. `*` cannot collide with an attribute name — Commander derives those from long flags, and
 * they are always camelCase identifiers.
 */
const WHOLE_OBJECT = "*";

function recordingProxy(
	value: Record<string, unknown>,
	sink: Set<string>,
): Record<string, unknown> {
	return new Proxy(value, {
		get(target, property, receiver) {
			if (typeof property === "string") sink.add(property);
			return Reflect.get(target, property, receiver);
		},
		ownKeys(target) {
			sink.add(WHOLE_OBJECT);
			return Reflect.ownKeys(target);
		},
	});
}

(Command.prototype as unknown as { opts: OptsFn }).opts = function (this: Command) {
	const value = REAL_OPTS.call(this);
	const state = RECORDING;
	if (!state || INSIDE_GLOBALS > 0) return value;
	if (this === state.target) return recordingProxy(value, state.own);
	if (state.ancestors.has(this)) return recordingProxy(value, state.ancestor);
	return value;
};

(Command.prototype as unknown as { optsWithGlobals: OptsFn }).optsWithGlobals = function (
	this: Command,
) {
	INSIDE_GLOBALS += 1;
	let merged: Record<string, unknown>;
	try {
		merged = REAL_OPTS_WITH_GLOBALS.call(this);
	} finally {
		INSIDE_GLOBALS -= 1;
	}
	const state = RECORDING;
	if (!state || INSIDE_GLOBALS > 0) return merged;
	if (this !== state.target && !state.ancestors.has(this)) return merged;
	return recordingProxy(merged, state.globals);
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The program under audit. Imported AFTER the mocks above.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const { program } = await import("../../src/program.js");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DISCOVERY — from the program, never from a list. A list is exactly what fails to catch the
// FOURTH instance, which is the whole reason this file exists.
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface CommanderArgumentLike {
	name(): string;
	required: boolean;
}

function commandArguments(command: Command): CommanderArgumentLike[] {
	const internals = command as unknown as {
		registeredArguments?: CommanderArgumentLike[];
		_args?: CommanderArgumentLike[];
	};
	return internals.registeredArguments ?? internals._args ?? [];
}

function hasActionHandler(command: Command): boolean {
	return typeof (command as unknown as { _actionHandler?: unknown })._actionHandler === "function";
}

export interface DiscoveredCommand {
	label: string;
	rootName: string;
	argvPath: string[];
	command: Command;
	ancestors: Command[];
}

/** The invocation as an operator would write it. The root of `program` is unnamed, so it falls
 *  back to the binary name; a fixture tree names its own root and keeps it. */
function labelFor(rootName: string, argvPath: readonly string[]): string {
	return [rootName, ...argvPath].join(" ");
}

export function discoverCommands(root: Command): DiscoveredCommand[] {
	const rootName = root.name() || "refarm";
	const found: DiscoveredCommand[] = [];
	const walk = (command: Command, argvPath: string[], ancestors: Command[]): void => {
		if (hasActionHandler(command)) {
			found.push({ label: labelFor(rootName, argvPath), rootName, argvPath, command, ancestors });
		}
		for (const child of command.commands) {
			walk(child, [...argvPath, child.name()], [...ancestors, command]);
		}
	};
	walk(root, [], []);
	return found;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ORACLE — measured, not assumed.
//
// `--version` and `--help` are the two options Commander ANSWERS ITSELF, before any action runs.
// They are declared on the root and reachable everywhere, and no action is expected to read them,
// so they are left out of the mirror entirely. This is the only option-level exclusion, and it is
// printed by the suite below rather than left implicit.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const COMMANDER_ANSWERED_OPTIONS = ["--version", "--help"] as const;

const MIRROR_VALUE = "__refarm_ancestor_option_mirror__";
const ARG_SENTINEL = "__refarm_ancestor_option_probe__";

interface ReachableOption {
	long: string;
	attribute: string;
	/** The command that declared it, as a label — where Commander will file it if it is misfiled. */
	declaredBy: string;
	takesValue: boolean;
	negated: boolean;
	/** `--x <args...>` collects into an ARRAY. Comparing it to the bare sentinel says the flag
	 *  never arrived, which is the opposite of what happened. ISS-151. */
	variadic: boolean;
}

function reachableOptions(entry: DiscoveredCommand): ReachableOption[] {
	const found = new Map<string, ReachableOption>();
	const chain: { command: Command; label: string }[] = [
		...entry.ancestors.map((ancestor, index) => ({
			command: ancestor,
			label: labelFor(entry.rootName, entry.argvPath.slice(0, index)),
		})),
		{ command: entry.command, label: entry.label },
	];
	for (const { command, label } of chain) {
		for (const option of command.options) {
			if (!option.long) continue;
			if ((COMMANDER_ANSWERED_OPTIONS as readonly string[]).includes(option.long)) continue;
			// The nearest declarer wins in this map, which is also the one the operator sees in
			// `--help`; the value recorded is where Commander would file it if it is misfiled.
			found.set(option.long, {
				long: option.long,
				attribute: option.attributeName(),
				declaredBy: label,
				takesValue: Boolean(option.required || option.optional),
				negated: Boolean((option as unknown as { negate?: boolean }).negate),
				variadic: Boolean((option as unknown as { variadic?: boolean }).variadic),
			});
		}
	}
	return [...found.values()];
}

/**
 * A structural MIRROR of the real tree: names, option FLAGS, and positional arity. Nothing else —
 * no action bodies, no argument parsers, no defaults.
 *
 * Dropping parsers and defaults is not a shortcut, it is the point. A parser would reject the
 * probe value on a validated option (`--limit <n>` wants a positive integer) and turn a
 * measurement into a parse error; a default would land in the leaf's `opts()` and disguise a
 * MISFILED option as an arrived one, which is precisely the false negative this oracle exists to
 * avoid. What survives is exactly the input to Commander's binding decision.
 */
export function mirrorTree(
	source: Command,
	argvPath: string[],
	sink: Map<string, Record<string, unknown>>,
): Command {
	const copy = new Command(source.name());
	copy.exitOverride();
	copy.configureOutput({ writeOut: () => {}, writeErr: () => {} });
	for (const argument of commandArguments(source)) {
		copy.argument(argument.required ? `<${argument.name()}>` : `[${argument.name()}]`);
	}
	for (const option of source.options) {
		if (!option.long) continue;
		if ((COMMANDER_ANSWERED_OPTIONS as readonly string[]).includes(option.long)) continue;
		copy.option(option.flags, option.description ?? "");
	}
	for (const child of source.commands) {
		copy.addCommand(mirrorTree(child, [...argvPath, child.name()], sink));
	}
	// Every node gets a recording action, so the mirror answers for a group with an action of its
	// own (`refarm config history`) as readily as for a leaf. Commander runs the INVOKED command's
	// action only, so the recorder walks up from there and snapshots the whole chain — that is what
	// lets a misfiled option be attributed to the ancestor that swallowed it, by name.
	copy.action(function (this: Command) {
		const chain = [...argvPath];
		let node: Command | null = this;
		while (node) {
			sink.set(chain.join(" "), REAL_OPTS.call(node));
			chain.pop();
			node = node.parent;
		}
	});
	return copy;
}

/**
 * DID THE PROBE VALUE LAND HERE? — asked of one command's `opts()`.
 *
 * A variadic option (`--x <args...>`) collects into an ARRAY, so the value that arrives is
 * `[MIRROR_VALUE]`, not `MIRROR_VALUE`. Comparing against the bare sentinel reported the flag as
 * never having arrived — and since "did not arrive" is exactly this file's definition of misfiled,
 * the guard told the author their operator's flag was being swallowed and to reach for
 * `optsWithGlobals()`, which would not have helped because nothing was wrong. ISS-151, found while
 * adding `refarm tools add`; no command in this CLI declared a variadic option at the time, which
 * is why it had never fired.
 *
 * Modelled rather than merely re-worded: an arrival this oracle cannot recognise is a false
 * positive, and a false positive in a guard is worse than a gap, because it is acted on.
 */
function arrived(value: unknown, option: ReachableOption): boolean {
	if (option.negated) return value === false;
	if (!option.takesValue) return value === true;
	if (option.variadic) return Array.isArray(value) && value.includes(MIRROR_VALUE);
	return value === MIRROR_VALUE;
}

export interface MisfiledOption extends ReachableOption {
	/** Where the value actually landed, as a label — the ancestor that swallowed it. */
	landedOn: string;
}

/**
 * Which of the options reachable at this command does Commander refuse to hand to its own
 * `opts()`? Measured by parsing a mirror once, with every reachable option supplied in the
 * position an operator would naturally type it: after the full subcommand path.
 *
 * A FRESH mirror per command, deliberately. Commander stores parsed values on the command object,
 * so a shared tree would carry a value written while a node stood as an ancestor into the run
 * where that same node is the invoked command — a stale `json: true` read back as "the flag
 * arrived", which is the exact false negative this oracle exists to rule out.
 */
export function misfiledOptions(root: Command, entry: DiscoveredCommand): {
	misfiled: MisfiledOption[];
	parseError: string | undefined;
} {
	const options = reachableOptions(entry);
	const sink = new Map<string, Record<string, unknown>>();
	const mirror = mirrorTree(root, [], sink);
	const argv = [...entry.argvPath];
	for (const argument of commandArguments(entry.command)) {
		if (argument.required) argv.push(ARG_SENTINEL);
	}
	for (const option of options) {
		argv.push(option.long);
		if (option.takesValue) argv.push(MIRROR_VALUE);
	}
	try {
		mirror.parse(argv, { from: "user" });
	} catch (error) {
		return {
			misfiled: [],
			parseError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
		};
	}
	const landedHere = sink.get(entry.argvPath.join(" ")) ?? {};
	const misfiled: MisfiledOption[] = [];
	for (const option of options) {
		if (arrived(landedHere[option.attribute], option)) continue;
		// Name the swallower rather than reporting "somewhere else". The recorder walks leaf → root,
		// so the first match is the NEAREST declaring ancestor, which is the one Commander chose.
		let landedOn = "(nowhere)";
		for (const [key, values] of sink) {
			if (arrived(values[option.attribute], option)) {
				landedOn = labelFor(entry.rootName, key.split(" ").filter(Boolean));
				break;
			}
		}
		misfiled.push({ ...option, landedOn });
	}
	return { misfiled, parseError: undefined };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// EXCLUSIONS — a debt, not a solution.
//
// Inherited verbatim from `cli-refusal-conformance.test.ts`: the same commands, the same effects
// that cannot be contained in-process, the same reasons. An excluded command is NOT silently
// dropped — the oracle still measures its misfiled options structurally (no action runs for that),
// and the suite PRINTS every excluded command together with the options it declares that
// Commander shadows, so the coverage this file does not have is written down rather than implied.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PROBE_EXCLUSIONS: Record<string, string> = {
	// ── Blocks on a human ────────────────────────────────────────────────────────────────────
	refarm:
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

	// ── Binds a listening socket ─────────────────────────────────────────────────────────────
	"refarm serve":
		"binds a listening HTTP port (the capability surface). Listening sockets are the one effect a sandboxed HOME/cwd cannot contain.",
	"refarm web serve":
		"binds a listening HTTP port; the operator has `refarm web serve` live on 4321 and this must never contend with it.",

	// ── Reaches the REAL operator state regardless of cwd ────────────────────────────────────
	// findRepoRoot() resolves the repository from the module's own location, not from
	// process.cwd(), so a sandboxed cwd does NOT redirect these.
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE PROBE
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 4_000;

export interface ProbeReads {
	own: Set<string>;
	ancestor: Set<string>;
	globals: Set<string>;
	timedOut: boolean;
	escaped: string | undefined;
}

class ProcessExitCalled extends Error {
	constructor(readonly exitCode: number) {
		super(`process.exit(${exitCode})`);
	}
}

/** Commander must never kill the test process, and its output must be captured, not printed.
 *  Both settings are copied to subcommands at CREATION time, so an already-built tree needs them
 *  applied node by node. */
function instrumentTree(root: Command, sink: string[]): void {
	const visit = (command: Command): void => {
		command.exitOverride();
		command.configureOutput({
			writeOut: (text) => sink.push(text),
			writeErr: (text) => sink.push(text),
		});
		for (const child of command.commands) visit(child);
	};
	visit(root);
}

export async function probeReads(
	root: Command,
	entry: DiscoveredCommand,
): Promise<ProbeReads> {
	const sink: string[] = [];
	instrumentTree(root, sink);

	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
	const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	const errWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
		throw new ProcessExitCalled(typeof code === "number" ? code : 0);
	}) as never);
	const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
		throw new Error("ancestor-option sandbox: process.kill refused");
	}) as never);

	const recording: Recording = {
		target: entry.command,
		ancestors: new Set(entry.ancestors),
		own: new Set(),
		ancestor: new Set(),
		globals: new Set(),
	};

	const argv = [...entry.argvPath];
	for (const argument of commandArguments(entry.command)) {
		if (argument.required) argv.push(ARG_SENTINEL);
	}

	const previousExitCode = process.exitCode;
	process.exitCode = undefined;
	let escaped: string | undefined;
	let timedOut = false;

	RECORDING = recording;
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
		if (!(error instanceof CommanderError) && !(error instanceof ProcessExitCalled)) {
			escaped = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		}
	} finally {
		RECORDING = null;
		process.exitCode = previousExitCode;
	}

	for (const spy of [logSpy, infoSpy, errSpy, warnSpy, outSpy, errWriteSpy, exitSpy, killSpy]) {
		spy.mockRestore();
	}

	return { ...recording, timedOut, escaped };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE VERDICT
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface Swallowed {
	long: string;
	attribute: string;
	landedOn: string;
	declaredBy: string;
}

/** The action asked its OWN `opts()` for this attribute — by name, or by enumerating the object. */
export function readsOwn(reads: ProbeReads, attribute: string): boolean {
	return reads.own.has(attribute) || reads.own.has(WHOLE_OBJECT);
}

/** The action consulted the CHAIN for this attribute — through `optsWithGlobals()`, or through an
 *  ancestor's own `opts()`. Either way the misfiled value was in reach. */
export function readsChain(reads: ProbeReads, attribute: string): boolean {
	return (
		reads.ancestor.has(attribute) ||
		reads.ancestor.has(WHOLE_OBJECT) ||
		reads.globals.has(attribute) ||
		reads.globals.has(WHOLE_OBJECT)
	);
}

/**
 * An option is SWALLOWED when the action asked its own `opts()` for it, Commander filed it
 * somewhere else, and nothing in the action ever consulted the chain for that same attribute.
 *
 * The acquittals are per-attribute, not per-command: a command that defends `--json` with
 * `optsWithGlobals()` and still reads `--local` off its own `opts()` is caught on `--local` alone.
 * And reading the local value FIRST is not a fault — `hasLocalOption` checks it before walking,
 * which is the correct shape and must not be punished.
 */
export function swallowedOptions(reads: ProbeReads, misfiled: MisfiledOption[]): Swallowed[] {
	return misfiled
		.filter((option) => readsOwn(reads, option.attribute) && !readsChain(reads, option.attribute))
		.map((option) => ({
			long: option.long,
			attribute: option.attribute,
			landedOn: option.landedOn,
			declaredBy: option.declaredBy,
		}));
}

function explainSwallowed(entry: DiscoveredCommand, swallowed: Swallowed[]): string {
	return swallowed
		.map(
			(option) =>
				`  ${option.long} — declared by \`${option.declaredBy}\`, Commander files it on ` +
				`\`${option.landedOn}\`, and \`${entry.label}\` reads \`${option.attribute}\` off its OWN ` +
				`opts(). The operator's flag never arrives. Read it with optsWithGlobals(), or walk the ` +
				`ancestors (hasJsonOption / hasLocalOption).`,
		)
		.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SUITE
// ─────────────────────────────────────────────────────────────────────────────────────────────

const COMMANDS = discoverCommands(program);

interface AtRisk {
	entry: DiscoveredCommand;
	misfiled: MisfiledOption[];
	parseError: string | undefined;
}

const MEASURED: AtRisk[] = COMMANDS.map((entry) => ({
	entry,
	...misfiledOptions(program, entry),
}));
const AT_RISK = MEASURED.filter((item) => item.misfiled.length > 0);
const PROBEABLE = AT_RISK.filter((item) => PROBE_EXCLUSIONS[item.entry.label] === undefined);
const UNPROBEABLE = AT_RISK.filter((item) => PROBE_EXCLUSIONS[item.entry.label] !== undefined);

/**
 * WHAT THE PROBE ACTUALLY SAW, per command — the answer to "is this audit vacuous?".
 *
 * A read audit that observes nothing passes everything. So every probe records which of the
 * command's misfiled options it saw being read at all (from any source), and the closing test
 * asserts a floor on that and PRINTS the commands where nothing was observed. An unobserved
 * command is not a failure — an action may legitimately never consult the flag on the path the
 * probe takes — but it is coverage this file does not have, and it is written down.
 */
interface Observation {
	observed: string[];
	unobserved: string[];
	timedOut: boolean;
	escaped: string | undefined;
}
const OBSERVED = new Map<string, Observation>();

// The instrument is a prototype patch and must outlive EVERY describe in this file — an `afterAll`
// registered inside the first block runs before the second block's tests, which would silently
// disarm the harness's own proof that it can go red.
afterAll(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	realNet.Server.prototype.listen = SOCKET_GUARDS.listen;
	realNet.Socket.prototype.connect = SOCKET_GUARDS.connect;
	realDgram.Socket.prototype.bind = SOCKET_GUARDS.bind;
	(Command.prototype as unknown as { opts: OptsFn }).opts = REAL_OPTS;
	(Command.prototype as unknown as { optsWithGlobals: OptsFn }).optsWithGlobals =
		REAL_OPTS_WITH_GLOBALS;
});

describe("ancestor option conformance", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("discovers every registered command from the program, not from a list", () => {
		expect(COMMANDS.length).toBeGreaterThan(100);
		// A mirror that silently stops measuring would report a clean run forever.
		expect(AT_RISK.length).toBeGreaterThan(50);
		expect(MEASURED.filter((item) => item.parseError !== undefined)).toEqual([]);
	});

	it("measures the three instances that motivated it as genuinely at risk", () => {
		// If a refactor ever makes one of these NOT at risk, this fails — and that is correct:
		// the audit below would have silently stopped covering the exact bug it was written for.
		const risky = new Map(AT_RISK.map((item) => [item.entry.label, item.misfiled]));
		expect(risky.get("refarm tasks show")?.map((option) => option.long)).toContain("--json");
		expect(risky.get("refarm config history undo")?.map((option) => option.long)).toContain(
			"--local",
		);
		expect(risky.get("refarm cert trust system")?.map((option) => option.long)).toContain("--json");
		// …and the swallower is named, not merely "somewhere else".
		expect(
			risky.get("refarm config history undo")?.find((option) => option.long === "--local")?.landedOn,
		).toBe("refarm config history");
	});

	it("names every exclusion and every option it leaves unaudited — neither is a silent skip", () => {
		console.log(
			[
				`ancestor option conformance — ${COMMANDS.length} commands discovered from the program;`,
				`${AT_RISK.length} have at least one option Commander files on an ancestor.`,
				"",
				`OPTION-LEVEL EXCLUSION (${COMMANDER_ANSWERED_OPTIONS.length}): ${COMMANDER_ANSWERED_OPTIONS.join(", ")}`,
				"  reason: Commander answers these itself and exits before any action runs, so no action",
				"  is expected to read them. They are left out of the mirror entirely.",
				"",
				`${UNPROBEABLE.length} COMMANDS AT RISK BUT NOT BEHAVIOURALLY AUDITED (the effect cannot be`,
				"contained in-process). Their misfiled options are measured structurally and listed here",
				"so the coverage this file does not have is written down:",
				...UNPROBEABLE.map(
					(item) =>
						`  ${item.entry.label}  [${item.misfiled.map((option) => option.long).join(", ")}]` +
						`\n      reason: ${PROBE_EXCLUSIONS[item.entry.label]}`,
				),
				"",
				`${PROBEABLE.length} commands are probed with their action running.`,
			].join("\n"),
		);
		// Every exclusion must name a real command, or it is stale cover for nothing.
		const labels = new Set(COMMANDS.map((command) => command.label));
		for (const label of Object.keys(PROBE_EXCLUSIONS)) {
			expect(labels, `stale exclusion: ${label} is not a registered command`).toContain(label);
		}
		for (const reason of Object.values(PROBE_EXCLUSIONS)) {
			expect(reason.length).toBeGreaterThan(40);
		}
	});

	it("contains every side effect before probing anything", () => {
		// The suite-wide guard from vitest.setup.ts is live on the fs the program graph sees.
		expect(() => realFs.writeFileSync(path.join(process.cwd(), "escape.txt"), "x")).toThrow(
			/sandbox/,
		);
		// No process ever spawns.
		expect(realChildProcess.spawnSync("git", ["status"]).error).toBeInstanceOf(Error);
		// No socket ever binds or connects.
		expect(() => realNet.createServer().listen(0)).toThrow(/sandbox/);
		expect(() => realDgram.createSocket("udp4").bind(0)).toThrow(/sandbox/);
	});

	for (const item of PROBEABLE) {
		it(
			`${item.entry.label} — reads [${item.misfiled.map((option) => option.long).join(", ")}] from the chain, not from its own opts()`,
			async () => {
				const reads = await probeReads(program, item.entry);
				const seen = (option: MisfiledOption) =>
					readsOwn(reads, option.attribute) || readsChain(reads, option.attribute);
				OBSERVED.set(item.entry.label, {
					observed: item.misfiled.filter(seen).map((option) => option.long),
					unobserved: item.misfiled.filter((option) => !seen(option)).map((option) => option.long),
					timedOut: reads.timedOut,
					escaped: reads.escaped,
				});
				const swallowed = swallowedOptions(reads, item.misfiled);
				expect(swallowed, `\n${explainSwallowed(item.entry, swallowed)}\n`).toEqual([]);
			},
			30_000,
		);
	}

	it("saw the options it claims to have audited — the audit is not vacuous", () => {
		// Declared last, so it runs after the probes above (vitest keeps declaration order).
		const withReads = [...OBSERVED.values()].filter((entry) => entry.observed.length > 0);
		const withoutReads = [...OBSERVED.entries()].filter(([, entry]) => entry.observed.length === 0);
		const timedOut = [...OBSERVED.entries()].filter(([, entry]) => entry.timedOut);
		console.log(
			[
				`${OBSERVED.size} commands probed with their action running.`,
				`${withReads.length} were observed reading at least one of the options Commander misfiles`,
				"for them — that is the audit doing work rather than passing on silence.",
				"",
				`${withoutReads.length} were probed but never read a misfiled option on the path the probe`,
				"takes. Not a failure; coverage this file does not have, listed so it is not implied:",
				...withoutReads.map(
					([label, entry]) =>
						`  ${label}  [${entry.unobserved.join(", ")}]` +
						(entry.escaped ? `  (action threw: ${entry.escaped})` : "") +
						(entry.timedOut ? "  (did not settle within the probe budget)" : ""),
				),
				"",
				`${timedOut.length} did not settle within ${PROBE_TIMEOUT_MS}ms — counted, never`,
				"asserted; see the note under the floors below.",
				...timedOut.map(([label]) => `  ${label}`),
			].join("\n"),
		);
		// The floor. If an upstream change ever disarms the instrument, this fails instead of the
		// suite reporting a clean run forever.
		//
		// BOTH FLOORS ARE COUNTS, deliberately — nothing here is asserted against a clock.
		// `expect(timedOut).toEqual([])` used to sit beside them and flaked: `PROBE_TIMEOUT_MS` is
		// 4s of WALL CLOCK raced against `parseAsync`, and these probes run inside a 250-file suite
		// with parallel workers, so a command that settles in milliseconds can lose that budget to
		// scheduling pressure alone. It failed once in a full run, then passed alone and on the
		// next full run (ISS-156). A floor that fails for load reasons teaches its reader to
		// re-run instead of read — which is precisely how the flag-never-arrives bug this file
		// exists to prevent would get waved past a fourth time.
		//
		// Nothing is lost by dropping it: a probe that does not settle records no reads, so a
		// systematic stall still fails `withReads` below. Timeouts are named and counted above,
		// where this file already writes down the coverage it does not have.
		expect(OBSERVED.size).toBe(PROBEABLE.length);
		expect(withReads.length).toBeGreaterThan(PROBEABLE.length / 2);
		// The three that motivated this file must each be OBSERVED, not merely probed.
		for (const label of [
			"refarm tasks show",
			"refarm config history undo",
			"refarm cert trust system",
		]) {
			expect(OBSERVED.get(label)?.observed, `${label} was never observed reading its option`)
				.not.toEqual([]);
		}
	});
});

/**
 * The harness must FAIL when a command regresses. A conformance suite that cannot go red is
 * decoration, so this drives the same machinery against a tree written to fail on purpose. The
 * fixture is never added to `program` — it exists only here, so it can never widen the real CLI.
 */
describe("ancestor option conformance — the harness itself", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function fixtureTree(): Command {
		const root = new Command("fixture");
		const group = root
			.command("group")
			.option("--json", "Output machine-readable JSON")
			.option("--local", "Act on the project-local trail")
			.action(() => {});

		// (1) The `tasks show` shape: declares --json, reads it off its own opts(). BROKEN.
		group
			.command("swallows-json")
			.argument("<id>")
			.option("--json", "Output machine-readable JSON")
			.action((_id: string, options: { json?: boolean }) => {
				void (options.json === true);
			});

		// (2) The `config history undo` shape: declares --local, reads it off its own opts().
		//     BROKEN, and destructively so.
		group
			.command("swallows-local")
			.argument("<id>")
			.option("--local", "Act on the project-local trail")
			.action((_id: string, options: { local?: boolean }) => {
				void (options.local === true);
			});

		// (3) The `cert trust system` fix: optsWithGlobals(). CORRECT.
		group
			.command("uses-globals")
			.option("--json", "Output machine-readable JSON")
			.action(function (this: Command, _options: unknown, command: Command) {
				void (command.optsWithGlobals<{ json?: boolean }>().json === true);
			});

		// (4) The `hasLocalOption` fix: local first, then an explicit ancestor walk. CORRECT.
		group
			.command("walks-ancestors")
			.option("--local", "Act on the project-local trail")
			.action((options: { local?: boolean }, command: Command) => {
				if (options.local === true) return;
				let node: Command | null = command;
				while (node) {
					if (node.opts<{ local?: boolean }>().local === true) return;
					node = node.parent;
				}
			});

		// (5b) VARIADIC, unshadowed. `--tags <t...>` collects into an array, so the probe value
		//      arrives as [MIRROR_VALUE]. Before ISS-151 the oracle compared against the bare
		//      sentinel, called it "(nowhere)", and told the author their flag was swallowed.
		group
			.command("variadic-unshadowed")
			.option("--tags <tags...>", "Tags")
			.action((options: { tags?: string[] }) => {
				void options.tags;
			});

		// (5c) VARIADIC and genuinely shadowed — the oracle must still catch this one. Modelling
		//      the array must not turn the guard off for the case it exists to find. Its own
		//      group, so declaring the ancestor option does not change what the cases above see.
		const variadicGroup = root
			.command("variadic-group")
			.option("--only <names...>", "Restrict")
			.action(() => {});
		variadicGroup
			.command("variadic-shadowed")
			.option("--only <names...>", "Restrict")
			.action((options: { only?: string[] }) => {
				void options.only;
			});

		// (5) No ancestor declares --depth, so reading it off opts() is CORRECT and must not be
		//     flagged. This is the false-positive guard: the rule fires on shadowing, not on opts().
		group
			.command("unshadowed")
			.option("--depth <n>", "How deep")
			.action((options: { depth?: string }) => {
				void options.depth;
			});

		return root;
	}

	function fixtureEntry(root: Command, label: string): DiscoveredCommand {
		const entry = discoverCommands(root).find((candidate) => candidate.label.endsWith(label));
		if (!entry) throw new Error(`fixture command not found: ${label}`);
		return entry;
	}

	async function judge(label: string): Promise<Swallowed[]> {
		const root = fixtureTree();
		const entry = fixtureEntry(root, label);
		const { misfiled, parseError } = misfiledOptions(root, entry);
		expect(parseError).toBeUndefined();
		const reads = await probeReads(root, entry);
		expect(reads.escaped).toBeUndefined();
		return swallowedOptions(reads, misfiled);
	}

	it("goes red on a command that reads a shadowed --json off its own opts()", async () => {
		expect((await judge("swallows-json")).map((option) => option.long)).toEqual(["--json"]);
	});

	it("goes red on a command that reads a shadowed --local off its own opts()", async () => {
		expect((await judge("swallows-local")).map((option) => option.long)).toEqual(["--local"]);
	});

	it("passes a command that reads through optsWithGlobals()", async () => {
		expect(await judge("uses-globals")).toEqual([]);
	});

	it("passes a command that walks its ancestors explicitly", async () => {
		expect(await judge("walks-ancestors")).toEqual([]);
	});

	it("leaves an unshadowed option alone — reading opts() is not itself a fault", async () => {
		expect(await judge("unshadowed")).toEqual([]);
	});

	it("does not call an unshadowed variadic option swallowed — it arrives as an array", async () => {
		// ISS-151. The array IS the arrival. Reporting it as "(nowhere)" sent the author to
		// optsWithGlobals() for a command where nothing was wrong.
		expect(await judge("variadic-unshadowed")).toEqual([]);
	});

	it("still catches a variadic option that IS shadowed", async () => {
		// The other half of the same fix: modelling the array must not disarm the rule.
		expect((await judge("variadic-shadowed")).map((option) => option.long)).toEqual(["--only"]);
	});

	it("measures the mirror against Commander itself rather than assuming a binding rule", () => {
		// The oracle's own premise, asserted: an option declared on BOTH the ancestor and the
		// subcommand is filed on the ANCESTOR, even typed after the subcommand. If a Commander
		// upgrade ever changes this, this fails first and the rule above is revisited rather than
		// silently over-firing.
		const root = fixtureTree();
		const entry = fixtureEntry(root, "swallows-json");
		const { misfiled } = misfiledOptions(root, entry);
		expect(misfiled.map((option) => option.long).sort()).toEqual(["--json", "--local"]);
		expect(misfiled.find((option) => option.long === "--json")?.landedOn).toBe("fixture group");
	});
});
