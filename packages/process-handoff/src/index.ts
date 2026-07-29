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
	exitCode: number;
	stdout?: string;
	stderr?: string;
	/** True when `options.timeout` elapsed and the child (and, per `killProcessGroup`'s
	 * mirrored strategy, its whole process group) was killed before it exited on its own.
	 * Present only when `options.timeout` was set. */
	timedOut?: boolean;
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
 *   - `options.timeout` bounds the run; on expiry the child (and its process group, via
 *     `killProcessGroup`) is killed and the result resolves with `timedOut: true` and
 *     `exitCode: -1`, mirroring the host's own timeout result shape.
 *   - `options.isolatedEnv` runs with exactly `options.env` (or `{}`), never falling back to
 *     `process.env` — mirrors the host's `env_clear().envs(env)`.
 *   - `options.outputCap` bounds captured stdout/stderr per stream, appending the host's own
 *     truncation marker.
 *   - `options.spawnErrorAsResult` resolves (rather than rejects) on a spawn failure, with
 *     `result.spawnError` set.
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
		let timedOut = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		if (hasTimeout) {
			timer = setTimeout(() => {
				timedOut = true;
				killProcessGroup(child);
			}, options.timeout);
			timer.unref?.();
		}

		const clearTimer = (): void => {
			if (timer) clearTimeout(timer);
		};

		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimer();
			if (options.spawnErrorAsResult) {
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
			reject(error);
		});

		child.once("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimer();
			resolve({
				exitCode: timedOut ? -1 : (code ?? 0),
				...(options.capture ? captured() : {}),
				...(hasTimeout ? { timedOut } : {}),
			});
		});
	});
}

export function runProcessHandoffSync(
	spec: ProcessHandoffSpec,
	options: ProcessHandoffRunOptions = {},
): ProcessHandoffRunResult {
	const result = spawnSync(spec.command, spec.args, {
		cwd: spec.cwd ?? process.cwd(),
		encoding: "utf-8",
		env: options.env ?? process.env,
		stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
		...(options.timeout ? { timeout: options.timeout } : {}),
	});
	return {
		exitCode: result.status ?? (result.error ? 1 : 0),
		...(options.capture ? { stdout: result.stdout ?? "", stderr: result.stderr ?? "" } : {}),
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
