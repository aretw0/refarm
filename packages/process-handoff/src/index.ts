import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ProcessHandoffSpec {
	packageManager?: string | null;
	command: string;
	args: string[];
	cwd?: string;
	display: string;
}

/**
 * Mirrors `MAX_SPAWN_STDIO_LEN` in `packages/tractor/src/host/host_effects_bridge/core.rs`
 * (1 MiB per stream). Pass `outputCap: true` on `ProcessHandoffRunOptions` to cap a captured
 * run at this many bytes per stream, the same limit the host's `read_spawn_pipe_limited`
 * enforces on every host-shell spawn.
 */
export const PROCESS_HANDOFF_OUTPUT_CAP_BYTES = 1024 * 1024;
/**
 * Byte-identical to the host's own truncation marker (`read_spawn_pipe_limited` in the same
 * file) — read from source, not guessed, so a probe's `expect` pattern that only matches
 * inside the truncated tail behaves identically on the CLI and on the host.
 */
export const PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER =
	"\n[truncated: spawn output exceeded limit]";

export interface ProcessHandoffRunOptions {
	capture?: boolean;
	env?: NodeJS.ProcessEnv;
	/** Milliseconds before the child is killed. Honored by the sync runner (spawnSync) and,
	 * additively, by the async `runProcessHandoff` (see its doc comment) — omitted means no
	 * deadline, preserving prior behavior for every existing async caller. */
	timeout?: number;
	/**
	 * When true, `runProcessHandoff` spawns with EXACTLY `env` (or `{}` when `env` is not
	 * given) — it never falls back to `process.env`, mirroring the Rust host's
	 * `env_clear().envs(env)` in `spawn_process` (`host_effects_bridge/core.rs`). This is
	 * what keeps a CLI-side result and a host-side result from diverging on a variable this
	 * process happens to have inherited but the caller never declared.
	 *
	 * Additive and opt-in: the default (`false`/omitted) keeps the existing
	 * `env ?? process.env` fallback, so every caller that does not pass this sees no
	 * behavior change.
	 */
	isolatedEnv?: boolean;
	/**
	 * Caps captured stdout/stderr (meaningful only alongside `capture: true`) at this many
	 * bytes per stream, appending `PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER` once exceeded.
	 * Pass `true` for the host's own 1 MiB limit (`PROCESS_HANDOFF_OUTPUT_CAP_BYTES`), a
	 * specific byte count, or omit/`false` for unbounded output — the existing behavior for
	 * every caller that does not pass this.
	 */
	outputCap?: number | boolean;
	/**
	 * When true, a spawn failure (the child never came to exist — `child.on("error")`: a
	 * missing binary, EACCES, a `cwd` that does not exist) resolves the returned promise
	 * with `result.spawnError` set, instead of rejecting it. This lets a caller distinguish
	 * "it ran and said no" (a normal non-zero `exitCode`) from "I could not run it" — the
	 * same distinction the Rust host expresses natively via its WIT `Result<T, E>` return
	 * type, rather than a thrown exception.
	 *
	 * Additive and opt-in: the default (`false`/omitted) keeps the existing rejection, so
	 * every caller relying on a `try`/`catch` (or `.catch()`) around `runProcessHandoff`
	 * keeps working unchanged.
	 */
	spawnErrorAsResult?: boolean;
}

export interface ProcessHandoffRunnerOptions extends ProcessHandoffRunOptions {
	cwd?: string;
	display?: string;
	packageManager?: string | null;
}

export type ProcessHandoffRunner = (
	command: string,
	args: string[],
	options?: ProcessHandoffRunnerOptions,
) => Promise<void>;

export interface ProcessHandoffRunResult {
	/**
	 * The child's exit code, or `-1` when it did not exit with one — a signal death (Node's
	 * `close` reports `code: null` in that case) or this module's own timeout. Mirrors the
	 * host's `status.code().unwrap_or(-1)` in `spawn_process`
	 * (`packages/tractor/src/host/host_effects_bridge/core.rs`): `-1` is the only fallback
	 * that cannot be misread as a clean exit, so a caller checking `exitCode !== 0` stays
	 * in parity with the host's `run_probe`, which folds exactly this case into `false`.
	 */
	exitCode: number;
	stdout?: string;
	stderr?: string;
	/** True when `options.timeout` elapsed and the child (and, per `killProcessGroup`'s
	 * mirrored strategy, its whole process group) was killed before it exited on its own.
	 * Present only when `options.timeout` was set. */
	timedOut?: boolean;
	/** The signal that killed the child, when Node's `close` event reported one — e.g. a
	 * process killed by something OTHER than this module's own timeout (an external
	 * SIGKILL, a segfault, an OOM kill). A timeout-driven kill reports via `timedOut`
	 * instead, not this field. Absent when the child exited normally (with a numeric exit
	 * code). Present so a caller can tell *how* a non-zero-looking result came to be —
	 * `exitCode` alone cannot distinguish "exited 0" from "killed by a signal", which is
	 * why `exitCode` never reports `0` for a signal death (see its doc note below). */
	signal?: NodeJS.Signals;
	/** Present only when `options.spawnErrorAsResult` is true and the spawn itself failed —
	 * see that option's doc comment. `exitCode` is `-1` in this case; nothing ran. */
	spawnError?: { message: string; code?: string };
}

export interface DetachedProcessHandoffOptions {
	logPath?: string;
	env?: NodeJS.ProcessEnv;
	onError?: (error: NodeJS.ErrnoException) => void;
}

export interface DetachedProcessHandoff {
	unref(): void;
}

export function quoteProcessHandoffArg(value: string): string {
	return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function createProcessHandoffDisplay(command: string, args: readonly string[] = []): string {
	return [command, ...args.map(quoteProcessHandoffArg)].join(" ");
}

export function createProcessHandoffSpec(
	commandDisplay: string,
	options: { cwd?: string } = {},
): ProcessHandoffSpec {
	const parsed = splitProcessHandoffCommand(commandDisplay);
	return {
		...parsed,
		...(options.cwd ? { cwd: options.cwd } : {}),
		display: commandDisplay,
	};
}

export function createProcessHandoffSpecFromRunner(
	command: string,
	args: string[],
	options: ProcessHandoffRunnerOptions = {},
): ProcessHandoffSpec {
	return {
		command,
		args,
		...(options.cwd ? { cwd: options.cwd } : {}),
		...(options.packageManager !== undefined ? { packageManager: options.packageManager } : {}),
		display: options.display ?? createProcessHandoffDisplay(command, args),
	};
}

export function splitProcessHandoffCommand(command: string): {
	command: string;
	args: string[];
} {
	const parts = splitCommandLine(command, "process handoff command");
	if (parts.length === 0) {
		throw new Error("Invalid process handoff command.");
	}

	return {
		command: parts[0]!,
		args: parts.slice(1),
	};
}

/**
 * SIGKILL the child's process group so grandchildren (e.g. a wrapper script that forked a
 * background job) die with it, rather than orphaning and getting reparented to init — then
 * falls back to killing the child directly. Mirrors `kill_process_group` in
 * `packages/tractor/src/host/host_effects_bridge/core.rs`: the host puts the child in its
 * OWN process group at spawn time (`process_group(0)`), so its PID doubles as the PGID, then
 * signals `-pgid`. Node's `detached: true` gives the same property on POSIX (the child leads
 * a new process group), so `-child.pid` targets it the same way. Only reachable when a
 * timeout is configured — see `runProcessHandoff`.
 */
function killProcessGroup(child: ChildProcess): void {
	if (typeof child.pid === "number") {
		try {
			// A negative pid signals the whole process group. ESRCH (the group is already
			// gone) is expected once the child has already exited and is safe to ignore.
			process.kill(-child.pid, "SIGKILL");
		} catch {
			// Fall through to the direct kill below.
		}
	}
	try {
		child.kill("SIGKILL");
	} catch {
		// Already dead.
	}
}

/**
 * Accumulates stdout/stderr capped at `capBytes`, appending
 * `PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER` once exceeded — byte-identical to the host's
 * `read_spawn_pipe_limited`. Truncation happens at a byte boundary, so a multi-byte
 * character straddling the cap decodes to a replacement character, matching the host's
 * `from_utf8_lossy`.
 */
function createBoundedTextAccumulator(capBytes: number): {
	push: (chunk: Buffer) => void;
	text: () => string;
} {
	const chunks: Buffer[] = [];
	let bytes = 0;
	let truncated = false;
	return {
		push(chunk: Buffer): void {
			if (truncated) return;
			const room = capBytes - bytes;
			if (chunk.length > room) {
				chunks.push(chunk.subarray(0, room));
				bytes = capBytes;
				truncated = true;
				return;
			}
			chunks.push(chunk);
			bytes += chunk.length;
		},
		text(): string {
			const text = Buffer.concat(chunks).toString("utf-8");
			return truncated ? text + PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER : text;
		},
	};
}

function resolveOutputCapBytes(outputCap: ProcessHandoffRunOptions["outputCap"]): number | null {
	if (outputCap === true) return PROCESS_HANDOFF_OUTPUT_CAP_BYTES;
	if (typeof outputCap === "number") return outputCap;
	return null;
}

/**
 * The async process-handoff runner — the one boundary `apps/refarm/src` calls through for
 * every non-interactive process it runs (see `packages/process-handoff`'s design note in
 * `docs/superpowers/specs/2026-07-29-process-administration-layer-design.md`, decision P1).
 *
 * Every new guarantee below is OPT-IN via `options`, so a caller that passes none of them
 * sees byte-for-byte the same spawn call, the same capture behavior, and the same
 * resolve/reject shape this function has always had:
 *   - `options.timeout` bounds the run; on expiry the child's process group is killed
 *     (`killProcessGroup`) and the call settles IMMEDIATELY from the timer itself —
 *     mirroring the host, which returns as soon as it kills rather than waiting for the
 *     child to fully exit (see the timer callback's own comment for why: a grandchild
 *     that escapes the killed group can hold the inherited stdio pipe open forever, and
 *     Node's `close` event would then never fire). Resolves `timedOut: true`,
 *     `exitCode: -1`.
 *   - `options.isolatedEnv` runs with exactly `options.env` (or `{}`), never falling back to
 *     `process.env` — mirrors the host's `env_clear().envs(env)`.
 *   - `options.outputCap` bounds captured stdout/stderr per stream, appending the host's own
 *     truncation marker.
 *   - `options.spawnErrorAsResult` resolves (rather than rejects) on a spawn failure, with
 *     `result.spawnError` set.
 *
 * Independent of any option: a signal-killed child (`close`'s `code` is `null`) always
 * resolves `exitCode: -1`, never `0` — see `ProcessHandoffRunResult.exitCode`'s doc
 * comment for why this one is not gated behind a flag.
 */
export function runProcessHandoff(
	spec: ProcessHandoffSpec,
	options: ProcessHandoffRunOptions = {},
): Promise<ProcessHandoffRunResult> {
	return new Promise((resolve, reject) => {
		const hasTimeout = typeof options.timeout === "number" && options.timeout > 0;
		const capBytes = resolveOutputCapBytes(options.outputCap);

		const child = spawn(spec.command, spec.args, {
			cwd: spec.cwd ?? process.cwd(),
			stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
			env: options.isolatedEnv ? (options.env ?? {}) : (options.env ?? process.env),
			// Lead its own process group only when a timeout might need to kill grandchildren
			// too (mirrors the host's `process_group(0)`). Scoped to the timeout path so
			// every non-timeout caller — including interactive, inherited-stdio runs — sees
			// no change in process-group/session behavior.
			...(hasTimeout ? { detached: true } : {}),
		});

		let stdout = "";
		let stderr = "";
		const stdoutBounded = capBytes !== null ? createBoundedTextAccumulator(capBytes) : null;
		const stderrBounded = capBytes !== null ? createBoundedTextAccumulator(capBytes) : null;

		if (options.capture) {
			if (stdoutBounded && stderrBounded) {
				child.stdout?.on("data", (chunk: Buffer) => stdoutBounded.push(chunk));
				child.stderr?.on("data", (chunk: Buffer) => stderrBounded.push(chunk));
			} else {
				child.stdout?.setEncoding("utf-8");
				child.stderr?.setEncoding("utf-8");
				child.stdout?.on("data", (chunk: string) => {
					stdout += chunk;
				});
				child.stderr?.on("data", (chunk: string) => {
					stderr += chunk;
				});
			}
		}

		const captured = (): { stdout: string; stderr: string } => ({
			stdout: stdoutBounded ? stdoutBounded.text() : stdout,
			stderr: stderrBounded ? stderrBounded.text() : stderr,
		});

		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		/** Marks the call as settled exactly once and cancels any pending timer. Returns
		 * false when something else already settled it — every settling site must check
		 * this before resolving/rejecting, so a `close`/`error`/timeout race never
		 * double-settles the promise. */
		const markSettled = (): boolean => {
			if (settled) return false;
			settled = true;
			if (timer) clearTimeout(timer);
			return true;
		};

		if (hasTimeout) {
			timer = setTimeout(() => {
				// Mirrors the host's timeout branch (`spawn_process` in
				// `host_effects_bridge/core.rs`): kill the process group and return
				// IMMEDIATELY, rather than waiting for the child to fully exit. Node's
				// `close` event fires only once every stdio stream has ALSO closed — a
				// grandchild that escaped the killed process group (e.g. a daemonizing
				// wrapper that called `setsid`, entirely plausible for something like a VPN
				// client) can hold the inherited pipe open indefinitely, and `close` would
				// then never fire. Settling HERE, not in the `close` handler, is what keeps
				// the timeout an actual deadline instead of a best-effort suggestion.
				// `killProcessGroup` runs unconditionally (a kill on an already-exited
				// child is a harmless no-op — see its own doc comment), but the result is
				// only resolved if nothing else settled the call first (a natural exit can
				// race the timer by a hair).
				killProcessGroup(child);
				if (!markSettled()) return;
				resolve({
					exitCode: -1,
					...(options.capture ? captured() : {}),
					timedOut: true,
				});
			}, options.timeout);
			timer.unref?.();
		}

		child.once("error", (error) => {
			if (options.spawnErrorAsResult) {
				if (!markSettled()) return;
				const errno = error as NodeJS.ErrnoException;
				resolve({
					exitCode: -1,
					...(options.capture ? captured() : {}),
					spawnError: {
						message: errno.message,
						...(typeof errno.code === "string" ? { code: errno.code } : {}),
					},
				});
				return;
			}
			if (!markSettled()) return;
			reject(error);
		});

		child.once("close", (code, signal) => {
			if (!markSettled()) return;
			resolve({
				// `code` is `null` when the child died by signal — falling back to `0`
				// there would report a killed process as a clean exit. `-1` (never `0`)
				// mirrors the host; see `ProcessHandoffRunResult.exitCode`'s doc comment.
				exitCode: code ?? -1,
				...(options.capture ? captured() : {}),
				...(signal ? { signal } : {}),
				...(hasTimeout ? { timedOut: false } : {}),
			});
		});
	});
}

/**
 * Truncates already-decoded text to `capBytes` UTF-8 bytes, appending
 * `PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER` when it had to cut — the sync counterpart of
 * `createBoundedTextAccumulator`. `spawnSync` hands back the full string in one shot (no
 * stream to cap as it arrives), so this caps it after the fact instead; the observable
 * result — the same byte-identical marker on anything over the limit — is the same either
 * way. `capBytes === null` (the default: no `outputCap` given) returns `text` unchanged,
 * preserving every existing sync caller's behavior exactly.
 */
function truncateToBytes(text: string, capBytes: number | null): string {
	if (capBytes === null) return text;
	const buf = Buffer.from(text, "utf-8");
	if (buf.length <= capBytes) return text;
	return buf.subarray(0, capBytes).toString("utf-8") + PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER;
}

export function runProcessHandoffSync(
	spec: ProcessHandoffSpec,
	options: ProcessHandoffRunOptions = {},
): ProcessHandoffRunResult {
	const capBytes = resolveOutputCapBytes(options.outputCap);
	const result = spawnSync(spec.command, spec.args, {
		cwd: spec.cwd ?? process.cwd(),
		encoding: "utf-8",
		// Honors `isolatedEnv` exactly like the async runner (see its doc comment) —
		// `ProcessHandoffRunOptions` is shared between both runners, and a sync caller
		// passing `isolatedEnv: true` must not silently get full `process.env`
		// inheritance instead. Additive: omitted/false preserves the existing
		// `env ?? process.env` fallback for every current sync caller.
		env: options.isolatedEnv ? (options.env ?? {}) : (options.env ?? process.env),
		stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
		...(options.timeout ? { timeout: options.timeout } : {}),
	});
	return {
		exitCode: result.status ?? (result.error ? 1 : 0),
		...(options.capture
			? {
					stdout: truncateToBytes(result.stdout ?? "", capBytes),
					stderr: truncateToBytes(result.stderr ?? "", capBytes),
				}
			: {}),
	};
}

export async function executeProcessHandoff(spec: ProcessHandoffSpec): Promise<number> {
	const result = await runProcessHandoff(spec);
	return result.exitCode;
}

export function createProcessHandoffRunner(
	runProcess: (
		spec: ProcessHandoffSpec,
		options?: ProcessHandoffRunOptions,
	) => Promise<ProcessHandoffRunResult> = runProcessHandoff,
): ProcessHandoffRunner {
	return async (command, args, options = {}) => {
		const spec = createProcessHandoffSpecFromRunner(command, args, options);
		const result = await runProcess(spec, options);
		if (result.exitCode !== 0) {
			throw new Error(`'${spec.display}' exited with code ${result.exitCode}`);
		}
	};
}

export function startDetachedProcessHandoff(
	spec: ProcessHandoffSpec,
	options: DetachedProcessHandoffOptions = {},
): DetachedProcessHandoff {
	const outputFd = options.logPath ? openProcessHandoffLog(options.logPath) : "ignore";
	try {
		const child = spawn(spec.command, spec.args, {
			cwd: spec.cwd ?? process.cwd(),
			detached: true,
			env: options.env ?? process.env,
			stdio: ["ignore", outputFd, outputFd],
		});
		child.once("error", (error) => {
			options.onError?.(error as NodeJS.ErrnoException);
		});
		child.unref();
		return child;
	} finally {
		if (typeof outputFd === "number") {
			fs.closeSync(outputFd);
		}
	}
}

function openProcessHandoffLog(logPath: string): number {
	fs.mkdirSync(path.dirname(logPath), { recursive: true });
	return fs.openSync(logPath, "a");
}

function splitCommandLine(commandLine: string, label = "command line"): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaping = false;

	for (const char of commandLine.trim()) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === "\\") {
			escaping = true;
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) {
				words.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (escaping) current += "\\";
	if (quote) throw new Error(`Unterminated quote in ${label}.`);
	if (current) words.push(current);
	return words;
}
