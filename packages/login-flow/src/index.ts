/**
 * login-flow — drive an interactive connect/login CLI to a "ready" state.
 *
 * Many real logins are a CLI that streams text and, somewhere in that stream, either reaches a
 * connected state, fails, asks for a secret, or needs the human to do something out-of-band (a
 * push approval on a phone, a hardware token). This is the generic engine for that: give it how
 * to spawn the process and a few patterns, and it watches the stream, responds to prompts via
 * stdin, surfaces human notices, and resolves when the process reaches `ready` (or fails / times
 * out). It is expect(1) scoped to "reach a connected state".
 *
 * The process is INJECTED (`spec.spawn`), so the whole state machine is unit-tested against a
 * fake — no real process, no real network, no real phone. `spawnLoginProcess` is the thin
 * `node:child_process` adapter for real use.
 *
 * Nothing here is tied to any vendor: the argv and the patterns are the caller's data. A specific
 * client (e.g. Serpro's `ovpnctl`) is a small adapter that fills in those patterns.
 */

import { spawn } from "node:child_process";

/** A live process the flow drives. Text arrives via `onData` as raw chunks (NOT assumed to be
 * whole lines — a prompt like `Senha (token): ` has no trailing newline). Injectable, so the
 * orchestrator is testable with a fake. */
export interface LoginFlowProcess {
	/** Register a listener for raw stdout+stderr text chunks. */
	onData(listener: (chunk: string) => void): void;
	/** Write to the process stdin (used to answer a prompt). */
	write(input: string): void;
	/** Terminate the process. */
	kill(): void;
	/** Resolves with the exit code when the process ends. */
	exited: Promise<number>;
}

export type LoginFlowReason = "ready" | "fail" | "timeout" | "exit";

export interface LoginFlowEvent {
	kind: "ready" | "fail" | "timeout" | "exit" | "prompt" | "notice";
	/** The matched text (absent for timeout/exit). NEVER a secret response. */
	matched?: string;
	/** For `notice`: the human message. For `prompt`: the prompt's label. For `exit`: the code. */
	message?: string;
}

/** A point in the stream that needs a stdin response. */
export interface LoginFlowPrompt {
	/** Matches the prompt in the stream (e.g. `/Senha \((.*)\): /`). */
	match: RegExp;
	/**
	 * Produce the response written to the process stdin (a trailing newline is added if absent).
	 * The RegExp match is passed (e.g. to name the token being unlocked). For a SECRET, read it
	 * with hidden input here and return it — the returned value is written to stdin only, never
	 * logged or emitted. Provide `label` for observability.
	 */
	respond: (match: RegExpMatchArray) => string | Promise<string>;
	/** A non-secret label for events/logs (e.g. "token-password"). */
	label?: string;
}

/** A point in the stream that should surface a message to the human (a push-approval wait, etc.). */
export interface LoginFlowNotice {
	match: RegExp;
	message: string;
}

export interface LoginFlowSpec {
	/** Start the process (injected; a fake in tests). */
	spawn: () => LoginFlowProcess;
	/** The pattern that means "reached the connected/ready state". */
	ready: RegExp;
	/** The pattern(s) that mean the attempt failed. */
	fail?: RegExp;
	/** Prompts answered via stdin, in priority order. Each fires once per occurrence. */
	prompts?: LoginFlowPrompt[];
	/** Human notices surfaced (do not settle the flow). Each fires once per occurrence. */
	notices?: LoginFlowNotice[];
	/** Observe every state event (never carries a secret). */
	onEvent?: (event: LoginFlowEvent) => void;
	/** Milliseconds to wait for `ready` before timing out (default 120_000). */
	timeoutMs?: number;
	/** Schedule the timeout (injected in tests for determinism). Returns a cancel function.
	 * Defaults to setTimeout/clearTimeout. */
	setTimer?: (callback: () => void, ms: number) => () => void;
}

export interface LoginFlowResult {
	ok: boolean;
	reason: LoginFlowReason;
	/** The full stream transcript (secrets never appear — responses are write-only). */
	transcript: string;
	/**
	 * The process. On success it is LEFT RUNNING — a connect CLI like `ovpnctl` HOLDS the tunnel
	 * after it reports ready, so the caller monitors/kills it. On fail/timeout it has been killed;
	 * on exit it had already ended.
	 */
	process: LoginFlowProcess;
}

const DEFAULT_TIMER: NonNullable<LoginFlowSpec["setTimer"]> = (callback, ms) => {
	const handle = setTimeout(callback, ms);
	return () => clearTimeout(handle);
};

/**
 * Drive `spec.spawn()`'s process to `spec.ready`. Resolves `{ ok: true, reason: "ready" }` with
 * the process LEFT RUNNING; `{ ok: false }` (killing the process) on `fail`/`timeout`, or on the
 * process exiting before it ever reached ready.
 */
export async function runLoginFlow(spec: LoginFlowSpec): Promise<LoginFlowResult> {
	const proc = spec.spawn();
	const emit = (event: LoginFlowEvent): void => spec.onEvent?.(event);
	const setTimer = spec.setTimer ?? DEFAULT_TIMER;

	return await new Promise<LoginFlowResult>((resolve) => {
		let transcript = ""; // everything seen — for ready/fail (idempotent, settle guarded)
		let pending = ""; // unconsumed tail — for prompts/notices (consumed on match → fire-once)
		let settled = false;

		const cancelTimer = setTimer(() => {
			emit({ kind: "timeout" });
			finish(false, "timeout");
		}, spec.timeoutMs ?? 120_000);

		function finish(ok: boolean, reason: LoginFlowReason): void {
			if (settled) return;
			settled = true;
			cancelTimer();
			// Leave a READY process running (it holds the connection); kill on fail/timeout; on
			// exit it has already ended.
			if (reason === "fail" || reason === "timeout") proc.kill();
			resolve({ ok, reason, transcript, process: proc });
		}

		proc.exited.then((code) => {
			emit({ kind: "exit", message: String(code) });
			// Exiting before `ready` is a failure — the target is a connected state, not an exit.
			finish(false, "exit");
		});

		proc.onData((chunk) => {
			if (settled) return;
			transcript += chunk;
			pending += chunk;

			if (spec.fail && spec.fail.test(transcript)) {
				finish(false, "fail");
				emit({ kind: "fail", matched: transcript.match(spec.fail)?.[0] });
				return;
			}
			if (spec.ready.test(transcript)) {
				finish(true, "ready");
				emit({ kind: "ready", matched: transcript.match(spec.ready)?.[0] });
				return;
			}

			// Prompts + notices scan the UNCONSUMED tail, consuming each match so it fires once.
			// A single pass per chunk handles the common one-event-per-chunk case.
			for (const prompt of spec.prompts ?? []) {
				const match = pending.match(prompt.match);
				if (match && match.index !== undefined) {
					pending = pending.slice(match.index + match[0].length);
					emit({ kind: "prompt", matched: match[0], message: prompt.label });
					Promise.resolve(prompt.respond(match)).then((response) => {
						if (settled) return;
						proc.write(response.endsWith("\n") ? response : `${response}\n`);
					});
				}
			}
			for (const notice of spec.notices ?? []) {
				const match = pending.match(notice.match);
				if (match && match.index !== undefined) {
					pending = pending.slice(match.index + match[0].length);
					emit({ kind: "notice", matched: match[0], message: notice.message });
				}
			}
		});
	});
}

export interface SuperviseEvent {
	kind: "connected" | "reconnected" | "dropped" | "reconnecting" | "gaveup" | "stopped";
	/** The (re)connect attempt number, for reconnecting/gaveup. */
	attempt?: number;
	/** Why the last flow attempt failed, for reconnecting. */
	reason?: LoginFlowReason;
}

export interface SuperviseSpec {
	/** The flow that (re)establishes the connection. `flow.spawn()` is called fresh each attempt. */
	flow: LoginFlowSpec;
	/**
	 * Is the connection currently up? Polled after connect, on `healthIntervalMs`. The moment it
	 * returns false the supervisor emits `dropped` and reconnects — this is where you "feel the pain
	 * early". For a VPN: `() => ovpntun0 is UP`.
	 */
	isHealthy: () => boolean | Promise<boolean>;
	/** Health poll interval (ms, default 5_000). */
	healthIntervalMs?: number;
	/** Backoff between failed (re)connect attempts (ms, default 3_000). */
	backoffMs?: number;
	/** Max CONSECUTIVE failed (re)connect attempts before giving up (default Infinity). Set a small
	 * number so a not-approved push doesn't spam retries forever. */
	maxAttempts?: number;
	onEvent?: (event: SuperviseEvent) => void;
	/** Injected sleep (tests). Defaults to setTimeout-based. */
	sleep?: (ms: number) => Promise<void>;
}

export interface ConnectionClosed {
	/** Why supervision ended: `stop()` was called, or it gave up reconnecting. */
	reason: "stopped" | "gaveup";
}

export interface ConnectionSupervisor {
	/** Resolves on the FIRST successful connect; rejects if the initial connect gives up. */
	connected: Promise<void>;
	/**
	 * Resolves when supervision ENDS — `stop()` was called, or it gave up reconnecting. Await this
	 * to exit cleanly instead of hanging: a consumer should `await supervisor.closed` rather than
	 * block forever, so a give-up (or a stop) tears the process down instead of lingering idle.
	 */
	closed: Promise<ConnectionClosed>;
	/** Stop supervising and tear down the connection (kills the held process). */
	stop(): Promise<void>;
}

/**
 * Keep a connection up: run the flow to connect, watch its health, and reconnect the instant it
 * drops. Returns immediately with a handle — `connected` resolves once, `stop()` tears it down.
 * The supervisor OWNS the live process (from `runLoginFlow`), so there is no orphaned babysitter.
 */
export function superviseConnection(spec: SuperviseSpec): ConnectionSupervisor {
	const sleep = spec.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
	const healthIntervalMs = spec.healthIntervalMs ?? 5_000;
	const backoffMs = spec.backoffMs ?? 3_000;
	const maxAttempts = spec.maxAttempts ?? Number.POSITIVE_INFINITY;
	const emit = (event: SuperviseEvent): void => spec.onEvent?.(event);

	let stopped = false;
	let current: LoginFlowProcess | undefined;
	let firstConnected = false;
	let resolveConnected!: () => void;
	let rejectConnected!: (error: Error) => void;
	const connected = new Promise<void>((resolve, reject) => {
		resolveConnected = resolve;
		rejectConnected = reject;
	});
	let resolveClosed!: (outcome: ConnectionClosed) => void;
	const closed = new Promise<ConnectionClosed>((resolve) => {
		resolveClosed = resolve;
	});
	let closedSettled = false;
	function finishClosed(reason: ConnectionClosed["reason"]): void {
		if (closedSettled) return;
		closedSettled = true;
		resolveClosed({ reason });
	}

	async function run(): Promise<void> {
		while (!stopped) {
			// (Re)connect, retrying with backoff up to maxAttempts consecutive failures.
			let attempt = 0;
			let result: LoginFlowResult;
			for (;;) {
				if (stopped) {
					finishClosed("stopped");
					return;
				}
				attempt += 1;
				result = await runLoginFlow(spec.flow);
				if (result.ok) break;
				emit({ kind: "reconnecting", attempt, reason: result.reason });
				if (attempt >= maxAttempts) {
					emit({ kind: "gaveup", attempt });
					if (!firstConnected) rejectConnected(new Error(`connect gave up after ${attempt} attempts`));
					finishClosed("gaveup");
					return;
				}
				await sleep(backoffMs);
			}
			if (stopped) {
				result.process.kill();
				finishClosed("stopped");
				return;
			}

			current = result.process;
			emit({ kind: firstConnected ? "reconnected" : "connected" });
			if (!firstConnected) {
				firstConnected = true;
				resolveConnected();
			}

			// Watch health until it drops (→ reconnect) or we're stopped.
			let dropped = false;
			while (!stopped && !dropped) {
				await sleep(healthIntervalMs);
				if (stopped) break;
				if (!(await spec.isHealthy())) {
					dropped = true;
					emit({ kind: "dropped" }); // felt within one poll interval
					current.kill();
				}
			}
		}
		current?.kill();
		finishClosed("stopped");
	}

	void run();

	return {
		connected,
		closed,
		async stop() {
			stopped = true;
			current?.kill();
			emit({ kind: "stopped" });
			finishClosed("stopped");
		},
	};
}

/**
 * The real `node:child_process` adapter — spawn a command as a `LoginFlowProcess`. stdout and
 * stderr are MERGED (a connect CLI often writes prompts/status to either), delivered as raw
 * chunks. `write` goes to the child's stdin.
 */
export function spawnLoginProcess(
	command: string,
	args: string[] = [],
	options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): LoginFlowProcess {
	const child = spawn(command, args, {
		cwd: options?.cwd,
		env: options?.env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const listeners: Array<(chunk: string) => void> = [];
	const deliver = (buffer: Buffer): void => {
		const text = buffer.toString("utf8");
		for (const listener of listeners) listener(text);
	};
	child.stdout?.on("data", deliver);
	child.stderr?.on("data", deliver);

	const exited = new Promise<number>((resolve) => {
		child.on("close", (code) => resolve(code ?? 0));
		child.on("error", () => resolve(127));
	});

	return {
		onData(listener) {
			listeners.push(listener);
		},
		write(input) {
			child.stdin?.write(input);
		},
		kill() {
			child.kill();
		},
		exited,
	};
}
