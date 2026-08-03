import readline from "node:readline";

export const PROMPT_CAPABILITY = "prompt:v1" as const;

// ── Prompt types ──────────────────────────────────────────────────────────────

export interface SelectOption {
	value: string;
	label: string;
	description?: string;
}

export interface ConfirmPrompt {
	type: "confirm";
	question: string;
	/** Default answer when the user presses Enter. Defaults to true. */
	default?: boolean;
}

export interface SelectPrompt {
	type: "select";
	question: string;
	options: SelectOption[];
	/** Value of the pre-selected option. Defaults to first option. */
	default?: string;
}

export interface TextPrompt {
	type: "text";
	question: string;
	/** Returned when the user submits an empty answer. */
	default?: string;
	/** Shown as a hint inside the prompt (does not constrain input). */
	placeholder?: string;
}

export interface SecretPrompt {
	type: "secret";
	question: string;
	/** Number of trailing characters to keep visible while typing. Defaults to 0. */
	visibleTail?: number;
}

export type OperatorPrompt = ConfirmPrompt | SelectPrompt | TextPrompt | SecretPrompt;

export class OperatorPromptCancelledError extends Error {
	constructor(message = "Operator prompt cancelled") {
		super(message);
		this.name = "OperatorPromptCancelledError";
	}
}

// ── OperatorChannel ───────────────────────────────────────────────────────────

export interface OperatorChannel {
	ask(prompt: ConfirmPrompt): Promise<boolean>;
	ask(prompt: SelectPrompt): Promise<string>;
	ask(prompt: TextPrompt): Promise<string>;
	ask(prompt: SecretPrompt): Promise<string>;
	ask(prompt: OperatorPrompt): Promise<boolean | string>;
}

export interface StdioOperatorChannelOptions {
	input?: NodeJS.ReadStream;
	output?: NodeJS.WriteStream;
	/**
	 * How a new prompt is separated from the trace already on screen.
	 * `space` is the readable default; `preserve` injects nothing; `clear` gives
	 * each step a fresh TTY screen (and degrades to spacing when output is piped).
	 */
	transition?: "preserve" | "space" | "clear";
	/**
	 * Interrupt an in-flight prompt from OUTSIDE the terminal — the outstanding
	 * `ask()` rejects with `OperatorPromptCancelledError`, exactly as a Ctrl+C
	 * would. Without this a terminal prompt can only be ended by the person in
	 * front of it, which is precisely the prompt-left-hanging failure when the
	 * same question was answered on another device (see
	 * `createPeeredOperatorChannel`). Optional and additive: a channel built
	 * without a signal behaves byte-for-byte as before.
	 */
	signal?: AbortSignal;
}

/**
 * Run `onAbort` when `signal` fires, and hand back the detach function to call
 * once the prompt settles. Fires immediately for an already-aborted signal, so
 * an abort that lands between constructing the channel and starting the prompt
 * is never lost. Returns a no-op detach when there is no signal.
 */
function onAbortOnce(signal: AbortSignal | undefined, onAbort: () => void): () => void {
	if (!signal) return () => {};
	if (signal.aborted) {
		onAbort();
		return () => {};
	}
	signal.addEventListener("abort", onAbort, { once: true });
	return () => signal.removeEventListener("abort", onAbort);
}

// ── createAutoOperatorChannel ─────────────────────────────────────────────────
// Returns the `default` value for every prompt without prompting.
// Use in non-interactive environments (CI, automated scripts).

export function createAutoOperatorChannel(): OperatorChannel {
	function ask(prompt: ConfirmPrompt): Promise<boolean>;
	function ask(prompt: SelectPrompt): Promise<string>;
	function ask(prompt: TextPrompt): Promise<string>;
	function ask(prompt: SecretPrompt): Promise<string>;
	async function ask(prompt: OperatorPrompt): Promise<boolean | string> {
		if (prompt.type === "confirm") return prompt.default ?? true;
		if (prompt.type === "select") return prompt.default ?? prompt.options[0]?.value ?? "";
		if (prompt.type === "secret") return "";
		return prompt.default ?? "";
	}
	return { ask };
}

// ── createScriptedOperatorChannel ────────────────────────────────────────────
// Returns predefined answers in sequence. Throws RangeError if exhausted.
// Use in tests to drive an OperatorChannel without stdin.

export function createScriptedOperatorChannel(answers: Array<boolean | string>): OperatorChannel {
	const queue = [...answers];
	function ask(prompt: ConfirmPrompt): Promise<boolean>;
	function ask(prompt: SelectPrompt): Promise<string>;
	function ask(prompt: TextPrompt): Promise<string>;
	function ask(prompt: SecretPrompt): Promise<string>;
	async function ask(_prompt: OperatorPrompt): Promise<boolean | string> {
		if (queue.length === 0) {
			throw new RangeError("createScriptedOperatorChannel: answer queue exhausted");
		}
		return queue.shift()!;
	}
	return { ask };
}

// ── createStdioOperatorChannel ────────────────────────────────────────────────
// Interactive readline implementation. No external dependencies.

/**
 * The terminal, and ONLY the terminal.
 *
 * This is what `createStdioOperatorChannel` was before a process could declare
 * somewhere else to publish its questions (see `setPromptPublisher`), and it is
 * still exactly what that function returns when nothing is declared. Kept
 * separate and exported so "the terminal alone" stays reachable by name — a host
 * that must not peer, and a test asserting the undeclared path is unchanged,
 * both need to say so rather than hope.
 */
export function createTerminalOperatorChannel(
	options: StdioOperatorChannelOptions = {},
): OperatorChannel {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;
	const signal = options.signal;
	function ask(prompt: ConfirmPrompt): Promise<boolean>;
	function ask(prompt: SelectPrompt): Promise<string>;
	function ask(prompt: TextPrompt): Promise<string>;
	function ask(prompt: SecretPrompt): Promise<string>;
	async function ask(prompt: OperatorPrompt): Promise<boolean | string> {
		writePromptTransition(output, options.transition ?? "space");
		if (prompt.type === "confirm") return askConfirm(prompt, input, output, signal);
		if (prompt.type === "select") return askSelect(prompt, input, output, signal);
		if (prompt.type === "secret") return askSecret(prompt, input, output, signal);
		return askText(prompt, input, output, signal);
	}
	return { ask };
}

function writePromptTransition(
	output: NodeJS.WriteStream,
	transition: NonNullable<StdioOperatorChannelOptions["transition"]>,
): void {
	if (transition === "preserve") return;
	if (transition === "clear" && output.isTTY) {
		output.write("\x1b[2J\x1b[H");
		return;
	}
	output.write("\n");
}

// ── The process's prompt publisher (ambient, opt-in, off by default) ──────────
//
// THE LAST MILE, and the reason it is here rather than in a wizard.
//
// A wizard asks through `createStdioOperatorChannel()`. For the same question to
// also reach the operator somewhere else — an attending device, a declared
// delivery channel — SOMETHING has to publish it, and D5 of the declared-delivery
// design says that something is never the wizard: "a wizard author writes nothing
// about delivery". The only remaining place is the construction of the channel
// itself, which is what these three functions make declarable.
//
// A HOST (the CLI, a daemon) declares once, at startup, where this process's
// questions are published. Every channel built afterwards is then a PEER of that
// publisher: the terminal and the elsewhere race, the first answer wins, and the
// loser is told (P2). No wizard learns any of it happened.
//
// NOTHING IS INSTALLED BY DEFAULT, and that is load-bearing. With no publisher
// declared, `createStdioOperatorChannel` returns `createTerminalOperatorChannel`
// — the same object, from the same code path, as before this existed. Silence is
// closed: a process that declares nothing behaves exactly as it did.

/** Somewhere else this process's questions can be answered. */
export interface PromptPublisher {
	/** Build the elsewhere-side channel for ONE ask, interruptible by `signal`. */
	remote(signal: AbortSignal): RemoteOperatorChannel;
}

/**
 * Where a publisher comes from, consulted at channel construction.
 *
 * A THUNK rather than a value so a host can declare the intent cheaply and pay
 * for it only if a question is actually asked: returning `null` means "not for
 * this process", and a process that never prompts never runs whatever the thunk
 * would have had to read.
 */
export type PromptPublisherSource = () => PromptPublisher | null;

let ambientPublisherSource: PromptPublisherSource | null = null;

/**
 * Declare where this process publishes its questions. Returns the undo.
 *
 * Deliberately process-global: the alternative is threading a publisher through
 * every wizard signature, which is precisely the D5 failure this exists to
 * avoid. Pass `null` to go back to the terminal alone.
 */
export function setPromptPublisher(source: PromptPublisherSource | null): () => void {
	const previous = ambientPublisherSource;
	ambientPublisherSource = source;
	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		ambientPublisherSource = previous;
	};
}

/**
 * The publisher in force, or null.
 *
 * TOTAL: a source that throws is treated as "nowhere else", because a broken
 * notification arrangement must never be the reason a wizard cannot ask its
 * question. The failure is not silent — the host that installed the source is
 * the one that reports it (D4) — but it stops here.
 */
export function currentPromptPublisher(): PromptPublisher | null {
	if (ambientPublisherSource === null) return null;
	try {
		return ambientPublisherSource() ?? null;
	} catch {
		return null;
	}
}

/**
 * One signal that fires when either fires, without leaving a listener behind on
 * the caller's (long-lived) signal once the ask has settled.
 */
function anySignal(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
	if (!a) return b;
	if (!b) return a;
	if (a.aborted) return a;
	if (b.aborted) return b;
	const controller = new AbortController();
	const abort = () => controller.abort();
	a.addEventListener("abort", abort, { once: true });
	b.addEventListener("abort", abort, { once: true });
	controller.signal.addEventListener(
		"abort",
		() => {
			a.removeEventListener("abort", abort);
			b.removeEventListener("abort", abort);
		},
		{ once: true },
	);
	return controller.signal;
}

/**
 * Ask the operator — at the terminal, and anywhere else this process declared.
 *
 * With no publisher declared this IS `createTerminalOperatorChannel`, unchanged.
 * With one declared, the terminal keeps working exactly as it does today and
 * gains a peer; see `createPeeredOperatorChannel` for what "peer" costs and
 * guarantees.
 */
export function createStdioOperatorChannel(
	options: StdioOperatorChannelOptions = {},
): OperatorChannel {
	const publisher = currentPromptPublisher();
	if (publisher === null) return createTerminalOperatorChannel(options);
	return createPeeredOperatorChannel({
		local: (signal) =>
			createTerminalOperatorChannel({ ...options, signal: anySignal(options.signal, signal) }),
		remote: (signal) => publisher.remote(signal),
	});
}

/**
 * Ask a single line via `rl.question`, settling with the raw answer text — or
 * rejecting with `OperatorPromptCancelledError` when the operator cancels, by
 * either way a terminal user quits: SIGINT (Ctrl+C) or closing stdin (Ctrl+D /
 * piped EOF). Node's `readline.Interface` already turns both into its own
 * 'SIGINT' and 'close' events (even against a fake, non-real-TTY stream, which
 * is what lets the conformance suite drive this without a real terminal), so
 * this only needs to listen for them and settle exactly once. Listeners are
 * always removed before the promise settles so nothing leaks onto `rl` (or the
 * shared input stream) across the next prompt.
 */
function askLine(
	rl: readline.Interface,
	query: string,
	signal?: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let detachAbort = () => {};
		const finish = (run: () => void) => {
			if (settled) return;
			settled = true;
			rl.off("SIGINT", onSigint);
			rl.off("close", onClose);
			detachAbort();
			run();
		};
		const onSigint = () =>
			finish(() => {
				rl.close();
				reject(new OperatorPromptCancelledError());
			});
		const onClose = () => finish(() => reject(new OperatorPromptCancelledError()));
		rl.on("SIGINT", onSigint);
		rl.on("close", onClose);
		// An outside interrupt ends the prompt exactly as Ctrl+C does: close the
		// interface so the terminal is handed back, then reject. Registered AFTER
		// the rl listeners so an already-aborted signal still tears both down.
		detachAbort = onAbortOnce(signal, () =>
			finish(() => {
				rl.close();
				reject(new OperatorPromptCancelledError());
			}),
		);
		// An already-aborted signal settled (and closed `rl`) above — asking a
		// closed interface a question nobody is waiting for is at best a no-op.
		if (settled) return;
		rl.question(query, (answer) =>
			finish(() => {
				rl.close();
				resolve(answer);
			}),
		);
	});
}

async function askConfirm(
	prompt: ConfirmPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
	signal?: AbortSignal,
): Promise<boolean> {
	const rl = readline.createInterface({ input, output });
	const hint = prompt.default === false ? "(y/N)" : "(Y/n)";
	const answer = await askLine(rl, `${prompt.question} ${hint} `, signal);
	const t = answer.trim().toLowerCase();
	if (!t) return prompt.default ?? true;
	return t !== "n" && t !== "no";
}

function askSelect(
	prompt: SelectPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
	signal?: AbortSignal,
): Promise<string> {
	if (input.isTTY && output.isTTY && typeof input.setRawMode === "function") {
		return askSelectTui(prompt, input, output, signal);
	}
	return askSelectNumbered(prompt, input, output, signal);
}

async function askSelectNumbered(
	prompt: SelectPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
	signal?: AbortSignal,
): Promise<string> {
	const rl = readline.createInterface({ input, output });
	output.write(`${prompt.question}\n`);
	prompt.options.forEach((opt, i) => {
		const marker = opt.value === prompt.default ? "▶" : " ";
		const desc = opt.description ? ` - ${opt.description}` : "";
		output.write(`  ${marker} ${i + 1}. ${opt.label}${desc}\n`);
	});
	const defaultIndex =
		prompt.default !== undefined
			? prompt.options.findIndex((o) => o.value === prompt.default) + 1
			: 1;
	const effectiveDefault = defaultIndex > 0 ? defaultIndex : 1;

	const answer = await askLine(rl, `Enter number (${effectiveDefault}): `, signal);
	const t = answer.trim();
	if (!t) {
		return prompt.default ?? prompt.options[0]?.value ?? "";
	}
	const n = parseInt(t, 10);
	const opt =
		Number.isFinite(n) && n >= 1 && n <= prompt.options.length
			? prompt.options[n - 1]
			: undefined;
	if (!opt) {
		process.stderr.write(`  Invalid choice, using default.\n`);
	}
	return opt?.value ?? prompt.default ?? prompt.options[0]?.value ?? "";
}

function askSelectTui(
	prompt: SelectPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
	signal?: AbortSignal,
): Promise<string> {
	if (prompt.options.length === 0) return Promise.resolve("");
	const defaultIndex =
		prompt.default !== undefined ? prompt.options.findIndex((o) => o.value === prompt.default) : 0;
	let selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;

	return new Promise((resolve, reject) => {
		const wasRaw = input.isRaw;
		let renderedLines = 0;
		let settled = false;
		let detachAbort = () => {};

		const render = () => {
			if (renderedLines > 0) {
				readline.moveCursor(output, 0, -renderedLines);
				readline.cursorTo(output, 0);
				readline.clearScreenDown(output);
			}
			const lines = [
				prompt.question,
				...prompt.options.map((opt, i) => {
					const marker = i === selectedIndex ? ">" : " ";
					const desc = opt.description ? ` - ${opt.description}` : "";
					return formatSelectLine(`  ${marker} ${opt.label}${desc}`, i === selectedIndex, output);
				}),
				"  Use Up/Down and Enter.",
			];
			output.write(lines.join("\n"));
			// Rows, not lines. `moveCursor` climbs PHYSICAL rows, and on a narrow terminal a
			// long option wraps into several — so counting the lines we MEANT to write made
			// the next redraw rise short, erase from the middle, and leave everything above
			// it on screen. Once per keystroke, that is the whole prompt reprinting itself.
			renderedLines = lines.reduce((rows, line) => rows + renderedRowsFor(line, output), 0) - 1;
		};

		const cleanup = () => {
			input.off("keypress", onKeypress);
			input.off("end", onEnd);
			detachAbort();
			input.setRawMode(wasRaw);
			input.pause();
			output.write("\n");
		};

		// Settle at most once — cancellation can race a completing keystroke, and
		// this guard is what keeps cleanup() (listeners + raw mode) from running
		// twice or a settled promise from being resolved/rejected again.
		const finish = (run: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			run();
		};

		// Defense in depth for a genuine stream close (e.g. piped stdin ending
		// mid-prompt) — Ctrl+D itself is caught below via the keypress handler,
		// since raw mode delivers it as data rather than a stream-level EOF.
		const onEnd = () => finish(() => reject(new OperatorPromptCancelledError()));

		const onKeypress = (str: string, key: readline.Key) => {
			if (key.ctrl && (key.name === "c" || key.name === "d")) {
				finish(() => reject(new OperatorPromptCancelledError()));
				return;
			}
			if (key.name === "up") {
				selectedIndex = (selectedIndex + prompt.options.length - 1) % prompt.options.length;
				render();
				return;
			}
			if (key.name === "down") {
				selectedIndex = (selectedIndex + 1) % prompt.options.length;
				render();
				return;
			}
			if (key.name === "return" || key.name === "enter") {
				finish(() => resolve(prompt.options[selectedIndex]?.value ?? ""));
				return;
			}
			if (/^[1-9]$/.test(str)) {
				const n = Number.parseInt(str, 10) - 1;
				if (n >= 0 && n < prompt.options.length) {
					selectedIndex = n;
					render();
				}
			}
		};

		readline.emitKeypressEvents(input);
		input.setRawMode(true);
		input.resume();
		input.on("keypress", onKeypress);
		input.once("end", onEnd);
		// Registered last, so an already-aborted signal tears down a fully set-up
		// prompt (raw mode restored, listeners removed) instead of half of one.
		detachAbort = onAbortOnce(signal, () =>
			finish(() => reject(new OperatorPromptCancelledError())),
		);
		if (!settled) render();
	});
}

function formatSelectLine(line: string, selected: boolean, output: NodeJS.WriteStream): string {
	if (!selected || !output.isTTY || process.env.NO_COLOR) return line;
	return `\x1b[7m${line}\x1b[0m`;
}

function promptSuffix(question: string): string {
	return /[:?]\s*$/.test(question) ? " " : ": ";
}

async function askText(
	prompt: TextPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
	signal?: AbortSignal,
): Promise<string> {
	const rl = readline.createInterface({ input, output });
	let hint = "";
	if (prompt.placeholder) hint += ` (${prompt.placeholder})`;
	if (prompt.default) hint += ` [${prompt.default}]`;
	const answer = await askLine(
		rl,
		`${prompt.question}${hint}${promptSuffix(prompt.question)}`,
		signal,
	);
	return answer.trim() || prompt.default || "";
}

/**
 * The mask, BOUNDED BY THE ROW.
 *
 * A secret prompt redraws in place — `clearLine` then `cursorTo(0)` — and that erases
 * exactly one physical row. A frame wider than the row wraps, so the redraw erases only
 * its last row and every earlier one survives, each still carrying its own `visibleTail`.
 * On a phone, pasting a token that way leaves a SLIDING WINDOW of the secret on screen,
 * and a sliding window of the last N characters reconstructs the whole string.
 *
 * So the row is the budget. The mask stops growing at it: the operator still sees input
 * arriving and still gets the tail to check their paste against, and every frame the
 * next one has to erase is one the next one CAN erase.
 *
 * `room` absent (a stream with no width) keeps the unbounded mask — there is no row to
 * overflow, and truncating against a guessed width would hide characters for no reason.
 */
/** How many physical rows a rendered line occupies, ANSI colour excluded from the width.
 *  A stream with no width is one row per line — there is nothing to wrap against. */
function renderedRowsFor(line: string, output: NodeJS.WriteStream): number {
	const columns = output.columns;
	if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0) return 1;
	// eslint-disable-next-line no-control-regex
	const visible = line.replace(/\u001b\[[0-9;]*m/g, "");
	return Math.max(1, Math.ceil(visible.length / columns));
}

function maskSecret(value: string, visibleTail: number, room?: number): string {
	const tail = visibleTail > 0 && value.length > visibleTail ? value.slice(-visibleTail) : "";
	const stars = value.length - tail.length;
	if (room === undefined || !Number.isFinite(room)) return "*".repeat(stars) + tail;

	const available = Math.max(0, Math.floor(room));
	const shownTail = tail.slice(Math.max(0, tail.length - available));
	const budget = Math.max(0, available - shownTail.length);
	return "*".repeat(Math.min(stars, budget)) + shownTail;
}

function askSecret(
	prompt: SecretPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
	signal?: AbortSignal,
): Promise<string> {
	const visibleTail = prompt.visibleTail ?? 0;

	if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
		return askText({ type: "text", question: prompt.question }, input, output, signal);
	}

	return new Promise((resolve, reject) => {
		let value = "";
		const wasRaw = input.isRaw;
		let settled = false;
		let detachAbort = () => {};

		const render = () => {
			readline.clearLine(output, 0);
			readline.cursorTo(output, 0);
			const label = `${prompt.question}: `;
			// Re-read the width per frame: a terminal can be resized mid-paste, and the
			// budget must follow the row that `clearLine` will actually erase.
			const columns = output.columns;
			const room =
				typeof columns === "number" && Number.isFinite(columns) && columns > 0
					? columns - label.length
					: undefined;
			output.write(`${label}${maskSecret(value, visibleTail, room)}`);
		};

		const cleanup = () => {
			input.off("keypress", onKeypress);
			input.off("end", onEnd);
			detachAbort();
			input.setRawMode(wasRaw);
			input.pause();
			output.write("\n");
		};

		// See askSelectTui's `finish` for why settling is guarded: cancellation can
		// race a completing keystroke, and this is what keeps cleanup() (listeners +
		// raw mode) from running twice or a settled promise from settling again.
		const finish = (run: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			run();
		};

		// Defense in depth for a genuine stream close — Ctrl+D itself is caught
		// below via the keypress handler, since raw mode delivers it as data
		// rather than a stream-level EOF.
		const onEnd = () => finish(() => reject(new OperatorPromptCancelledError()));

		const onKeypress = (str: string, key: readline.Key) => {
			if (key.ctrl && (key.name === "c" || key.name === "d")) {
				finish(() => reject(new OperatorPromptCancelledError()));
				return;
			}
			if (key.name === "return" || key.name === "enter") {
				finish(() => resolve(value));
				return;
			}
			if (key.name === "backspace") {
				value = value.slice(0, -1);
				render();
				return;
			}
			if (!key.ctrl && !key.meta && str) {
				value += str;
				render();
			}
		};

		readline.emitKeypressEvents(input);
		input.setRawMode(true);
		input.resume();
		input.on("keypress", onKeypress);
		input.once("end", onEnd);
		// Registered last — see askSelectTui. An abort here discards `value`
		// without rendering or returning it: an interrupted secret is not an answer.
		detachAbort = onAbortOnce(signal, () =>
			finish(() => reject(new OperatorPromptCancelledError())),
		);
		if (!settled) render();
	});
}

// ── Conformance runner ────────────────────────────────────────────────────────

export interface OperatorChannelConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

export interface OperatorChannelConformanceOptions {
	/**
	 * Simulate an operator cancelling an in-flight prompt — e.g. for a
	 * `createStdioOperatorChannel` under test, deliver a SIGINT (or end the fake
	 * input stream) to its underlying I/O. Conformance calls this once, right
	 * after starting a prompt, and requires the outstanding `ask()` to settle by
	 * rejecting with `OperatorPromptCancelledError`.
	 *
	 * Omit for a channel with no cancellable I/O window: `createAutoOperatorChannel`
	 * and `createScriptedOperatorChannel` resolve every prompt synchronously from a
	 * default/canned answer and never wait on external input, so there is nothing
	 * for a SIGINT/EOF to interrupt. Without `triggerCancel`, conformance only
	 * checks that `ask()` still settles promptly — which it trivially does — rather
	 * than requiring a cancellation rejection those channels have no way to produce.
	 */
	triggerCancel?: () => void;
}

/** How long a channel gets to settle after `triggerCancel` fires before conformance
 * treats it as hung. Generous relative to real settling (same event-loop turn), but
 * short enough that a genuinely broken (never-settling) channel fails fast. */
const CONFORMANCE_CANCEL_TIMEOUT_MS = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOperatorChannelConformance(
	channel: OperatorChannel,
	options: OperatorChannelConformanceOptions = {},
): Promise<OperatorChannelConformanceResult> {
	const failures: string[] = [];
	let checksRun = 0;

	// 1 — confirm returns boolean
	checksRun++;
	try {
		const result = await channel.ask({ type: "confirm", question: "_conformance_", default: true });
		if (typeof result !== "boolean") failures.push("confirm: did not return boolean");
	} catch (e) {
		failures.push(`confirm threw: ${String(e)}`);
	}

	// 2 — select returns a value present in options
	checksRun++;
	try {
		const opts: SelectOption[] = [
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		];
		const result = await channel.ask({
			type: "select",
			question: "_conformance_",
			options: opts,
			default: "a",
		});
		if (typeof result !== "string") failures.push("select: did not return string");
		else if (!opts.some((o) => o.value === result))
			failures.push(`select: returned value not in options: "${result}"`);
	} catch (e) {
		failures.push(`select threw: ${String(e)}`);
	}

	// 3 — text returns string
	checksRun++;
	try {
		const result = await channel.ask({
			type: "text",
			question: "_conformance_",
			default: "hello",
		});
		if (typeof result !== "string") failures.push("text: did not return string");
	} catch (e) {
		failures.push(`text threw: ${String(e)}`);
	}

	// 4 — secret returns string
	checksRun++;
	try {
		const result = await channel.ask({
			type: "secret",
			question: "_conformance_",
		});
		if (typeof result !== "string") failures.push("secret: did not return string");
	} catch (e) {
		failures.push(`secret threw: ${String(e)}`);
	}

	// 5 — cancellation: ask() must settle once cancellation is triggered, never
	// hang. An unsettled prompt promise is exactly the defect this check exists to
	// catch (an operator's Ctrl+C leaving an "unsettled top-level await" behind).
	checksRun++;
	{
		const pending = channel.ask({ type: "text", question: "_conformance_cancel_" });
		// Attach the outcome handler immediately (not after the race) so a channel
		// that settles LATE — after the timeout below already lost the race — never
		// produces its own unhandled-rejection warning; this itself always settles.
		const outcome = pending.then(
			() => "resolved" as const,
			(error) => (error instanceof OperatorPromptCancelledError ? "cancelled" : "rejected-other"),
		);
		options.triggerCancel?.();
		const settled = await Promise.race([outcome, delay(CONFORMANCE_CANCEL_TIMEOUT_MS).then(() => "timeout" as const)]);
		if (settled === "timeout") {
			failures.push("cancellation: ask() did not settle after cancellation was triggered");
		} else if (options.triggerCancel && settled !== "cancelled") {
			failures.push(
				`cancellation: expected rejection with OperatorPromptCancelledError, got "${settled}"`,
			);
		}
	}

	const failed = failures.length;
	return { pass: failed === 0, total: checksRun, failed, failures };
}

// ── The pending prompt on the wire ────────────────────────────────────────────
//
// P6 (docs/superpowers/specs/2026-07-30-pending-prompt-wire-design.md): the wire
// shape is the reusable part, so it is designed rather than extracted from an
// adapter afterwards. Three consumers read it — the node's remote channel, the
// attending kit command, and (later) a browser — so it carries what a prompt IS
// and nothing about how a surface draws it.
//
// It lives HERE, in the zero-dependency block that is already vendored into
// `packages/farm-client`, because the phone must be able to parse it with
// nothing installed.

/** Wire discriminator. Bump only for a breaking change to the shape below. */
export const PENDING_PROMPT_WIRE = "pending-prompt.v1" as const;

// ── Skew: the declared version, CHECKED ───────────────────────────────────────
//
// `GET /prompts` has always declared `wire` in its envelope. Declaring it and
// having nobody read it is decoration: a node that moved to a newer shape would
// be talked to, by a frozen client, exactly as though nothing had happened —
// misparsing quietly rather than refusing loudly. The kit on the operator's
// phone is a VENDORED copy frozen at whatever `farm-update` last fetched, and a
// page cached in a browser is the same frozen client with a different name, so
// "the other side is older than me" is the normal condition here, not the exotic
// one.
//
// The check lives HERE, beside the constant it enforces, for the same reason the
// shape does: this block is zero-dependency and already travels inside the kit,
// so the phone can make the judgement with nothing installed.
//
// ── EXACT MATCH, NOT A COMPATIBILITY RULE ────────────────────────────────────
//
// `pending-prompt.v1` is ONE opaque discriminator, not a semver triple. There is
// no minor or patch component a rule could be lenient about, so any rule would
// first have to invent a versioning scheme the wire does not have — and then be
// right about it forever, in a frozen copy on a device nobody can reach.
//
// It is also unnecessary. The doc above says the constant is bumped ONLY for a
// breaking change, which means every difference in it is by construction
// breaking. Additive, non-breaking growth already needs no bump at all:
// `parsePendingPrompt` ignores fields it does not know, so the shape can gain
// them without the discriminator moving. Friendliness therefore already exists,
// in the parser, where it is tested. A second lenient mechanism layered on the
// version would overlap it and could be WRONG, which is the one thing this check
// exists to prevent.
//
// So: string equality. Blunt, and it cannot mislead.

export type PendingPromptWireVerdict = "compatible" | "incompatible" | "unknown";

/**
 * The verdict on a peer's declared wire version.
 *
 * Three answers, not two — the same distinction this codebase keeps making
 * between `down` and `unknown`, between no-peers and could-not-ask. "The peer
 * says something I cannot speak" and "the peer said nothing" are different
 * facts with different right responses, and collapsing them is how a silent
 * break happens.
 */
export interface PendingPromptWireCheck {
	readonly verdict: PendingPromptWireVerdict;
	/** What the peer declared, or `null` when it declared nothing at all. */
	readonly declared: string | null;
	/** What the side doing the checking speaks. */
	readonly expected: string;
}

/**
 * The `wire` a `GET /prompts` envelope declared, or `null`.
 *
 * An empty string is `null`, not a version: a peer that sent `""` declared
 * nothing, and treating it as a version to compare against would manufacture an
 * incompatibility out of a blank field.
 */
export function readDeclaredPendingPromptWire(body: unknown): string | null {
	if (!isRecord(body)) return null;
	const declared = body.wire;
	return typeof declared === "string" && declared !== "" ? declared : null;
}

/**
 * Compare what a peer declared against what this side speaks.
 *
 * PURE, and it decides nothing about what to DO — a surface reads `verdict` and
 * chooses its own words and its own remedy, because the remedy differs by
 * surface (a kit runs `farm-update`; a browser reloads). What must not differ,
 * and therefore lives here, is the judgement itself.
 *
 * ── WHY `unknown` IS ADMITTED AND NOT REFUSED ────────────────────────────────
 *
 * `unknown` is a peer that declared nothing. In this topology there is exactly
 * one thing that can be: a peer OLDER than the declaration. Every peer that has
 * the field sends it, so refusing on `unknown` would refuse precisely the older
 * peers — and the older peer, always, is the operator's phone, whose kit is
 * frozen at the last `farm-update`, and the browser tab holding a cached page.
 * A safety mechanism whose first act is to lock the operator out of a device
 * that works today has not made anything safer.
 *
 * It is admitted, not ignored. The verdict stays `unknown` all the way to the
 * surface, which says so; nobody is left believing a version was checked when
 * none was offered. That is the difference between admitting a case and
 * collapsing it into `compatible`.
 */
export function checkPendingPromptWire(
	declared: string | null,
	expected: string = PENDING_PROMPT_WIRE,
): PendingPromptWireCheck {
	if (declared === null) return { verdict: "unknown", declared: null, expected };
	return {
		verdict: declared === expected ? "compatible" : "incompatible",
		declared,
		expected,
	};
}

/** The verdict on a `GET /prompts` envelope, in one call. */
export function checkPendingPromptListWire(
	body: unknown,
	expected: string = PENDING_PROMPT_WIRE,
): PendingPromptWireCheck {
	return checkPendingPromptWire(readDeclaredPendingPromptWire(body), expected);
}

/**
 * The interval an attending device is TOLD to poll at, and the ceiling backoff
 * may walk to. Stated rather than implied: honest polling means a declared
 * interval and a backoff, not as-fast-as-possible (E5 of the phone-initiated
 * enrolment design; the traffic doctrine says the same).
 */
export const PENDING_PROMPT_POLL_INTERVAL_MS = 2_000;
export const PENDING_PROMPT_POLL_MAX_INTERVAL_MS = 20_000;

/**
 * Answering identities that are NOT devices on the wire.
 *
 * ` terminal` is the stdio peer that asked; ` node-local` is an unauthenticated
 * caller on the node's own loopback listener. Both describe a position an
 * enrolled device is definitionally not in, so a settlement that recorded either
 * for a remote caller would LIE about who answered — and the record of which
 * device answered is the whole of P3.
 *
 * The leading space is the same trick `auth.ts` uses for its select sentinels,
 * for the same reason: `validateIdentityLabel` trims, so a validated device
 * label can never begin with one and can never collide with these.
 */
export const TERMINAL_PROMPT_DEVICE = " terminal";
export const NODE_LOCAL_PROMPT_DEVICE = " node-local";
export const RESERVED_PROMPT_DEVICES: readonly string[] = [
	TERMINAL_PROMPT_DEVICE,
	NODE_LOCAL_PROMPT_DEVICE,
];

/** Who asked. Enough to recognise the question at a glance on a small screen,
 *  and to recognise an asker that is gone. */
export interface PendingPromptAsker {
	/** What the operator would recognise, e.g. `refarm auth enrol`. */
	command: string;
	/** The asking process, so a dead asker is identifiable. */
	pid?: number;
	/** The node the asker runs on. */
	host?: string;
}

/**
 * A question waiting for an operator, as it crosses the wire.
 *
 * Deliberately absent: any rendering instruction, and any answer. A surface
 * decides how to draw `prompt`; the shape does not.
 */
export interface PendingPrompt {
	wire: typeof PENDING_PROMPT_WIRE;
	id: string;
	/** Kind, question, options, constraints — the prompt itself, unchanged. */
	prompt: OperatorPrompt;
	/**
	 * P4 — answering this from another device sends the ANSWER across the wire.
	 * Authenticated per-device and inside the tailnet, but crossing nonetheless,
	 * and the attending surface must say so BEFORE the operator types.
	 */
	answerTravels: boolean;
	asker: PendingPromptAsker;
	/** Epoch ms. */
	askedAt: number;
	/** P5 — the ASKER's deadline, epoch ms. `null` when it declared none. */
	expiresAt: number | null;
}

/** Why a prompt ended without an answer (P5). */
export type PendingPromptAbandonReason = "cancelled" | "expired" | "withdrawn";

/**
 * How a prompt ended, and who ended it.
 *
 * Carries NO answer value, on purpose: a settlement is the part that is safe to
 * show, return to a losing peer, and write to a log, and a secret prompt's value
 * must never be any of those (P4). The value reaches the asker through the
 * ticket alone.
 */
export interface PendingPromptSettlement {
	promptId: string;
	outcome: "answered" | "abandoned";
	/** Which device settled it (P3), or a reserved identity above. */
	device: string;
	reason?: PendingPromptAbandonReason;
	/** Epoch ms. */
	at: number;
}

/** True when answering this prompt would put its value on the wire (P4). */
export function promptAnswerTravels(prompt: OperatorPrompt): boolean {
	return prompt.type === "secret";
}

export interface ToPendingPromptOptions {
	id: string;
	asker: PendingPromptAsker;
	/** Epoch ms; defaults to `Date.now()`. */
	askedAt?: number;
	/** The asker's deadline in ms from `askedAt`. `null`/omitted → no deadline. */
	timeoutMs?: number | null;
}

/** Build the wire shape for a prompt about to be published. PURE. */
export function toPendingPrompt(
	prompt: OperatorPrompt,
	options: ToPendingPromptOptions,
): PendingPrompt {
	const askedAt = options.askedAt ?? Date.now();
	const timeoutMs = options.timeoutMs ?? null;
	return {
		wire: PENDING_PROMPT_WIRE,
		id: options.id,
		prompt,
		answerTravels: promptAnswerTravels(prompt),
		asker: options.asker,
		askedAt,
		expiresAt: timeoutMs === null ? null : askedAt + timeoutMs,
	};
}

// ── Parsing: a device receives untrusted JSON ─────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function parseSelectOptions(value: unknown): SelectOption[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const options: SelectOption[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) return null;
		const optValue = asString(raw.value);
		const label = asString(raw.label);
		if (optValue === null || label === null) return null;
		const description = asString(raw.description);
		options.push(description === null ? { value: optValue, label } : { value: optValue, label, description });
	}
	return options;
}

/**
 * Validate an `OperatorPrompt` off the wire. Returns null rather than throwing —
 * a malformed entry in a list must not take down the whole list on a phone.
 */
export function parseOperatorPrompt(value: unknown): OperatorPrompt | null {
	if (!isRecord(value)) return null;
	const question = asString(value.question);
	if (question === null) return null;
	switch (value.type) {
		case "confirm":
			return typeof value.default === "boolean"
				? { type: "confirm", question, default: value.default }
				: { type: "confirm", question };
		case "select": {
			const options = parseSelectOptions(value.options);
			if (options === null) return null;
			const fallback = asString(value.default);
			const valid = fallback !== null && options.some((o) => o.value === fallback);
			return valid
				? { type: "select", question, options, default: fallback }
				: { type: "select", question, options };
		}
		case "text": {
			const prompt: TextPrompt = { type: "text", question };
			const fallback = asString(value.default);
			if (fallback !== null) prompt.default = fallback;
			const placeholder = asString(value.placeholder);
			if (placeholder !== null) prompt.placeholder = placeholder;
			return prompt;
		}
		case "secret":
			return typeof value.visibleTail === "number" && Number.isFinite(value.visibleTail)
				? { type: "secret", question, visibleTail: value.visibleTail }
				: { type: "secret", question };
		default:
			return null;
	}
}

/** Validate a `PendingPrompt` off the wire, or null. Round-trips `toPendingPrompt`. */
export function parsePendingPrompt(value: unknown): PendingPrompt | null {
	if (!isRecord(value)) return null;
	if (value.wire !== PENDING_PROMPT_WIRE) return null;
	const id = asString(value.id);
	if (id === null || id === "") return null;
	const prompt = parseOperatorPrompt(value.prompt);
	if (prompt === null) return null;
	if (!isRecord(value.asker)) return null;
	const command = asString(value.asker.command);
	if (command === null) return null;
	if (typeof value.askedAt !== "number" || !Number.isFinite(value.askedAt)) return null;
	const expiresAt =
		typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
			? value.expiresAt
			: null;
	if (value.expiresAt !== null && expiresAt === null) return null;
	const asker: PendingPromptAsker = { command };
	if (typeof value.asker.pid === "number" && Number.isFinite(value.asker.pid)) {
		asker.pid = value.asker.pid;
	}
	const host = asString(value.asker.host);
	if (host !== null) asker.host = host;
	return {
		wire: PENDING_PROMPT_WIRE,
		id,
		prompt,
		// Recomputed from the prompt, never trusted from the wire: a peer that
		// under-reported `answerTravels` would silently strip P4's warning off a
		// secret. The kind decides, and the kind is right here.
		answerTravels: promptAnswerTravels(prompt),
		asker,
		askedAt: value.askedAt,
		expiresAt,
	};
}

/** Validate a list payload, dropping entries that do not parse. */
export function parsePendingPromptList(value: unknown): PendingPrompt[] {
	const raw = isRecord(value) && Array.isArray(value.prompts) ? value.prompts : [];
	const parsed: PendingPrompt[] = [];
	for (const entry of raw) {
		const prompt = parsePendingPrompt(entry);
		if (prompt !== null) parsed.push(prompt);
	}
	return parsed;
}

// ── Answers: the shape's own constraints ──────────────────────────────────────

export type PendingPromptAnswerCheck =
	| { ok: true; value: boolean | string }
	| { ok: false; reason: string };

const CONFIRM_TRUE = new Set(["true", "yes", "y", "1"]);
const CONFIRM_FALSE = new Set(["false", "no", "n", "0"]);

/**
 * Is this a legal answer to this prompt? Constraints live with the shape (P6),
 * so every surface enforces the same ones — a select cannot settle on a value
 * that was never offered, whichever device typed it.
 *
 * Rejection reasons never quote the submitted value: for a secret prompt that
 * would put the secret in an error string, which is the one place it must not go.
 */
export function checkPendingPromptAnswer(
	prompt: OperatorPrompt,
	value: unknown,
): PendingPromptAnswerCheck {
	if (prompt.type === "confirm") {
		if (typeof value === "boolean") return { ok: true, value };
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			if (CONFIRM_TRUE.has(normalized)) return { ok: true, value: true };
			if (CONFIRM_FALSE.has(normalized)) return { ok: true, value: false };
		}
		return { ok: false, reason: "confirm expects a boolean" };
	}
	if (typeof value !== "string") return { ok: false, reason: `${prompt.type} expects a string` };
	if (prompt.type === "select") {
		return prompt.options.some((option) => option.value === value)
			? { ok: true, value }
			: { ok: false, reason: "select expects one of the offered option values" };
	}
	return { ok: true, value };
}

/**
 * Which identity to record for an answer (P3): the one the transport's GATE
 * resolved, and nothing else.
 *
 * There is deliberately no way for a caller to name itself, not even as a
 * suggestion when the gate resolved nobody. That is the whole defence of the
 * ungated loopback path: a local caller may answer (it could equally walk to the
 * terminal and type), but it is recorded as ` node-local` and can never claim to
 * have been an enrolled device. An attribution a caller can choose is not an
 * attribution.
 *
 * Trimming is what makes the reserved sentinels unreachable from outside: a
 * gate-resolved label loses any leading space, so it can never come back as one.
 */
export function resolveAnsweringDevice(authenticated?: string | null): string {
	const resolved = typeof authenticated === "string" ? authenticated.trim() : "";
	return resolved || NODE_LOCAL_PROMPT_DEVICE;
}

// ── The hub: pending prompts, in memory, for as long as their askers live ─────
//
// P1: nothing here is persisted, and nothing is garbage-collected. A pending
// prompt's lifetime IS its asker's lifetime — if the process holding this hub
// dies, its questions die with it, which is correct, because there is no longer
// anyone waiting for the answer. Persisting them would produce a question whose
// asker is gone, answerable, and answering nothing.

/** What the asker gets back from `publish`. */
export interface PendingPromptTicket {
	pending: PendingPrompt;
	/** Settles exactly once, ever. `value` is null for an abandoned prompt. */
	settled: Promise<{ settlement: PendingPromptSettlement; value: boolean | string | null }>;
	/**
	 * End the prompt without an answer (P5) — the operator cancelled, the
	 * deadline passed, or the asker is giving up. Idempotent: returns false when
	 * something else already settled it.
	 */
	withdraw(reason?: PendingPromptAbandonReason, device?: string): boolean;
}

export type PendingPromptAnswerResult =
	| { ok: true; settlement: PendingPromptSettlement }
	| { ok: false; reason: "unknown" }
	| { ok: false; reason: "already-settled"; settlement: PendingPromptSettlement }
	| { ok: false; reason: "invalid"; detail: string };

export interface PendingPromptHubOptions {
	/**
	 * Ceiling on simultaneously pending prompts. Not a queue that grows: publish
	 * beyond it REFUSES, loudly, rather than accumulating questions nobody will
	 * ever see. A node asks one question per blocked command; reaching this means
	 * something is wrong, and a wrong thing should say so.
	 */
	maxPending?: number;
	/**
	 * How many settled prompts stay recallable, so a peer that LOST the race is
	 * told what happened instead of getting a bare 404 (P2). Fixed-size ring —
	 * bounded by construction, never grown.
	 */
	recentSettlements?: number;
	now?: () => number;
}

export interface PendingPromptHub {
	/** The interval attending devices are told to poll at. */
	readonly pollIntervalMs: number;
	publish(pending: PendingPrompt): PendingPromptTicket;
	/** Every prompt still waiting, oldest first. Never includes settled ones. */
	list(): PendingPrompt[];
	/** Settle a prompt with an answer. First caller wins; the rest are told why. */
	answer(promptId: string, value: unknown, device: string): PendingPromptAnswerResult;
	/** How a recently-settled prompt ended, or null once it has aged out. */
	settlementOf(promptId: string): PendingPromptSettlement | null;
	/** Called on every publish — what a push transport would hook, and what a
	 *  test attendant uses instead of polling. Returns an unsubscribe. */
	subscribe(listener: (pending: PendingPrompt) => void): () => void;
}

interface HubEntry {
	pending: PendingPrompt;
	settle(settlement: PendingPromptSettlement, value: boolean | string | null): void;
	settled: boolean;
}

export function createPendingPromptHub(options: PendingPromptHubOptions = {}): PendingPromptHub {
	const maxPending = options.maxPending ?? 64;
	const recentCapacity = options.recentSettlements ?? 32;
	const now = options.now ?? (() => Date.now());

	const entries = new Map<string, HubEntry>();
	const recent: PendingPromptSettlement[] = [];
	const listeners = new Set<(pending: PendingPrompt) => void>();

	function remember(settlement: PendingPromptSettlement): void {
		recent.push(settlement);
		while (recent.length > recentCapacity) recent.shift();
	}

	/**
	 * THE first-answer-wins rule, in one place (P2).
	 *
	 * The whole rule is these three lines, and they are synchronous with no await
	 * between the read of `entry.settled` and the write — so on a single-threaded
	 * runtime this is an atomic compare-and-set. Two devices answering in the same
	 * tick, a remote answer landing as the terminal answers, a withdraw racing an
	 * answer: all of them funnel through here, and exactly one gets `true`.
	 *
	 * Every other path (answer, withdraw, expiry, cancellation) MUST settle by
	 * calling this and MUST respect its verdict. Nothing else may touch
	 * `entry.settled` or resolve the ticket.
	 */
	function claim(
		entry: HubEntry,
		settlement: PendingPromptSettlement,
		value: boolean | string | null,
	): boolean {
		if (entry.settled) return false;
		entry.settled = true;
		entries.delete(entry.pending.id);
		remember(settlement);
		entry.settle(settlement, value);
		return true;
	}

	function publish(pending: PendingPrompt): PendingPromptTicket {
		if (entries.has(pending.id)) {
			throw new RangeError(`createPendingPromptHub: prompt id already pending: ${pending.id}`);
		}
		if (entries.size >= maxPending) {
			throw new RangeError(
				`createPendingPromptHub: ${maxPending} prompts already pending — refusing to queue more`,
			);
		}
		let settle!: (
			resolution: { settlement: PendingPromptSettlement; value: boolean | string | null },
		) => void;
		const promise = new Promise<{
			settlement: PendingPromptSettlement;
			value: boolean | string | null;
		}>((resolve) => {
			settle = resolve;
		});
		const entry: HubEntry = {
			pending,
			settled: false,
			settle: (settlement, value) => settle({ settlement, value }),
		};
		entries.set(pending.id, entry);
		for (const listener of listeners) listener(pending);
		return {
			pending,
			settled: promise,
			withdraw: (reason = "withdrawn", device = TERMINAL_PROMPT_DEVICE) =>
				claim(
					entry,
					{ promptId: pending.id, outcome: "abandoned", device, reason, at: now() },
					null,
				),
		};
	}

	return {
		pollIntervalMs: PENDING_PROMPT_POLL_INTERVAL_MS,
		publish,
		list: () => [...entries.values()].map((entry) => entry.pending),
		answer(promptId, value, device) {
			const entry = entries.get(promptId);
			if (!entry) {
				const settlement = recent.find((s) => s.promptId === promptId);
				// "The answer is no" and "I could not ask" are different answers, and
				// a peer that lost a race deserves the first one.
				return settlement ? { ok: false, reason: "already-settled", settlement } : { ok: false, reason: "unknown" };
			}
			const check = checkPendingPromptAnswer(entry.pending.prompt, value);
			if (!check.ok) return { ok: false, reason: "invalid", detail: check.reason };
			const settlement: PendingPromptSettlement = {
				promptId,
				outcome: "answered",
				device,
				at: now(),
			};
			if (!claim(entry, settlement, check.value)) {
				const won = recent.find((s) => s.promptId === promptId);
				return won
					? { ok: false, reason: "already-settled", settlement: won }
					: { ok: false, reason: "unknown" };
			}
			return { ok: true, settlement };
		},
		settlementOf: (promptId) => recent.find((s) => s.promptId === promptId) ?? null,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

// ── The remote channel ────────────────────────────────────────────────────────

/**
 * The asker's deadline passed with nobody answering (P5).
 *
 * Deliberately NOT an `OperatorPromptCancelledError`: a blocked CLI that waits
 * forever is a CLI that gets killed with Ctrl+C and leaves half-applied state,
 * so expiry is an outcome the asker handles — and it is a different outcome from
 * the operator saying no.
 */
export class OperatorPromptExpiredError extends Error {
	constructor(message = "Operator prompt expired") {
		super(message);
		this.name = "OperatorPromptExpiredError";
	}
}

export interface RemoteOperatorChannelOptions {
	hub: PendingPromptHub;
	asker: PendingPromptAsker;
	/** The asker's deadline in ms (P5). `null` for none. Default 10 minutes. */
	timeoutMs?: number | null;
	/** Interrupts the wait — the local peer won, or the operator gave up. */
	signal?: AbortSignal;
	now?: () => number;
	newId?: () => string;
}

export interface RemoteOperatorChannel extends OperatorChannel {
	/** How the most recent `ask()` ended, and which device ended it (P2/P3). */
	lastSettlement(): PendingPromptSettlement | null;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60 * 1000;

let idCounter = 0;

/** Unique enough for prompts within one asker's lifetime, which is all a
 *  never-persisted id has to be (P1). No crypto import for a non-secret. */
function defaultPromptId(): string {
	idCounter += 1;
	return `p-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * An `OperatorChannel` answered from somewhere else: it publishes the prompt to
 * the hub and waits for whichever attending device settles it.
 *
 * Every wizard already written goes through `OperatorChannel`, so this adapter
 * is what makes all of them remotely answerable without one of them changing.
 */
export function createRemoteOperatorChannel(
	options: RemoteOperatorChannelOptions,
): RemoteOperatorChannel {
	const { hub, asker } = options;
	const now = options.now ?? (() => Date.now());
	const newId = options.newId ?? defaultPromptId;
	const timeoutMs = options.timeoutMs === undefined ? DEFAULT_PROMPT_TIMEOUT_MS : options.timeoutMs;
	let last: PendingPromptSettlement | null = null;

	function ask(prompt: ConfirmPrompt): Promise<boolean>;
	function ask(prompt: SelectPrompt): Promise<string>;
	function ask(prompt: TextPrompt): Promise<string>;
	function ask(prompt: SecretPrompt): Promise<string>;
	async function ask(prompt: OperatorPrompt): Promise<boolean | string> {
		const pending = toPendingPrompt(prompt, {
			id: newId(),
			asker,
			askedAt: now(),
			timeoutMs,
		});
		const ticket = hub.publish(pending);
		const detachAbort = onAbortOnce(options.signal, () => {
			ticket.withdraw("cancelled", TERMINAL_PROMPT_DEVICE);
		});
		let timer: ReturnType<typeof setTimeout> | null = null;
		if (pending.expiresAt !== null) {
			timer = setTimeout(
				() => ticket.withdraw("expired", TERMINAL_PROMPT_DEVICE),
				Math.max(0, pending.expiresAt - now()),
			);
			// A pending question must never be the reason a CLI refuses to exit.
			timer.unref?.();
		}
		try {
			const { settlement, value } = await ticket.settled;
			last = settlement;
			if (settlement.outcome === "answered") return value as boolean | string;
			if (settlement.reason === "expired") {
				throw new OperatorPromptExpiredError(
					`No answer before the deadline (asked by ${asker.command}).`,
				);
			}
			throw new OperatorPromptCancelledError();
		} finally {
			detachAbort();
			if (timer) clearTimeout(timer);
		}
	}

	return { ask, lastSettlement: () => last };
}

// ── The peered channel: local and remote are peers (P2) ───────────────────────

export interface PeeredOperatorChannelOptions {
	/** Build the terminal side for ONE ask, interruptible by `signal`. */
	local(signal: AbortSignal): OperatorChannel;
	/** Build the remote side for ONE ask, interruptible by `signal`. */
	remote(signal: AbortSignal): RemoteOperatorChannel;
	/** Where the loser is told. Defaults to stderr — never stdout, which is the
	 *  asker's own output. Receives a message only; never an answer value. */
	notify?(message: string): void;
}

function defaultNotify(message: string): void {
	process.stderr.write(`${message}\n`);
}

/**
 * Offer one prompt at the terminal that asked AND to attending devices at the
 * same time; the first answer wins and the loser is told (P2).
 *
 * The stdio channel is NOT demoted by this: sitting at the desk stays the
 * fastest path, and the phone is what you reach for when you are not at the
 * desk. The failure this exists to avoid is a prompt left visibly hanging at a
 * terminal someone is looking at, which is why losing locally ABORTS the local
 * prompt and says which device answered instead of going quiet.
 *
 * A remote side that is simply broken (sidecar down, transport error) must not
 * be able to break the terminal: its failure is swallowed and the local prompt
 * keeps waiting. Only an expiry — the ASKER's own deadline, which belongs to the
 * ask rather than to either surface — ends both sides.
 */
export function createPeeredOperatorChannel(
	options: PeeredOperatorChannelOptions,
): OperatorChannel {
	const notify = options.notify ?? defaultNotify;

	function ask(prompt: ConfirmPrompt): Promise<boolean>;
	function ask(prompt: SelectPrompt): Promise<string>;
	function ask(prompt: TextPrompt): Promise<string>;
	function ask(prompt: SecretPrompt): Promise<string>;
	async function ask(prompt: OperatorPrompt): Promise<boolean | string> {
		const localAbort = new AbortController();
		const remoteAbort = new AbortController();
		const remoteChannel = options.remote(remoteAbort.signal);

		type Outcome =
			| { side: "local" | "remote"; ok: true; value: boolean | string }
			| { side: "local" | "remote"; ok: false; error: unknown };

		// Both handlers are attached at creation, so a side that settles LATE —
		// after the other already won — can never surface as an unhandled rejection.
		const settle = (side: "local" | "remote", promise: Promise<boolean | string>) =>
			promise.then(
				(value): Outcome => ({ side, ok: true, value }),
				(error): Outcome => ({ side, ok: false, error }),
			);

		const localTask = settle("local", options.local(localAbort.signal).ask(prompt));
		const remoteTask = settle("remote", remoteChannel.ask(prompt));

		const inFlight = new Set<Promise<Outcome>>([localTask, remoteTask]);
		try {
			while (inFlight.size > 0) {
				const outcome = await Promise.race(inFlight);
				inFlight.delete(outcome.side === "local" ? localTask : remoteTask);

				if (outcome.side === "local") {
					// The terminal settled it, either way. Withdraw the question from
					// every attending device: a prompt answered here is not still open
					// there.
					remoteAbort.abort();
					if (outcome.ok) return outcome.value;
					throw outcome.error;
				}

				if (outcome.ok) {
					// Answered elsewhere. Say WHERE — silence is what leaves a prompt
					// hanging at a terminal someone is watching.
					localAbort.abort();
					const device = remoteChannel.lastSettlement()?.device ?? "another device";
					notify(`↩ answered on ${device} — this prompt is settled here.`);
					return outcome.value;
				}
				if (outcome.error instanceof OperatorPromptExpiredError) {
					// The asker's deadline, not a surface's — it ends both sides.
					localAbort.abort();
					throw outcome.error;
				}
				// The remote side is unavailable or was withdrawn. The operator is
				// still standing at the terminal; keep the prompt they can see.
			}
			// Unreachable: the local task always settles into one of the branches above.
			throw new OperatorPromptCancelledError();
		} finally {
			// A prompt that has settled is settled on BOTH sides — a still-published
			// question after the asker moved on is exactly the artifact P1 refuses.
			remoteAbort.abort();
			localAbort.abort();
		}
	}

	return { ask };
}

// ── The HTTP surface, as a pure function ──────────────────────────────────────
//
// Framework-free on purpose: the semantics of the wire belong with the shape
// (P6), not with whichever server happens to mount them. A host adapts its own
// request/response objects to these two plain records and gets identical
// behaviour — which is also what lets the races be tested without a socket.

export interface PendingPromptHttpRequest {
	method: string;
	/** Path only — no query string, no origin. */
	path: string;
	/** Parsed JSON body, if any. */
	body?: unknown;
	/**
	 * The device identity the LISTENER's gate resolved, or null when this
	 * listener does not authenticate (the node's own loopback socket).
	 */
	authenticatedDevice?: string | null;
}

export interface PendingPromptHttpResponse {
	status: number;
	body: Record<string, unknown>;
}

const ANSWER_PATH = /^\/prompts\/([^/]+)\/answer$/;

/**
 * Serve the pending-prompt surface.
 *
 * WHO MAY ANSWER (P3): exactly whoever this listener let through. There is no
 * finer permission model here, because an enrolled device IS the operator's
 * device — but the settlement records WHICH one, and the identity it records is
 * the gate's, never the caller's own claim (see `resolveAnsweringDevice`).
 *
 * ON THE UNGATED LOOPBACK LISTENER: the node additionally listens on 127.0.0.1
 * without the credential layer, by design — a token the node presents to itself
 * defends nothing against someone who already has local shell. That reasoning
 * survives here: a local caller could equally walk to the terminal that asked
 * and type the answer, so answering from loopback grants no authority local
 * shell did not already have. Two things must still hold, and are enforced
 * below rather than assumed:
 *
 *   1. an unauthenticated caller is recorded as `node-local` and may NOT claim
 *      to be an enrolled device or the terminal — otherwise the record of who
 *      answered would be forgeable, and that record is the whole of P3;
 *   2. nothing readable comes back that was not already local knowledge: a
 *      settlement carries no answer value, so this surface cannot be used to
 *      read an answer — only to give one.
 */
export function handlePendingPromptHttp(
	hub: PendingPromptHub,
	request: PendingPromptHttpRequest,
): PendingPromptHttpResponse {
	const method = request.method.toUpperCase();

	if (request.path === "/prompts") {
		if (method !== "GET") return { status: 405, body: { error: "method-not-allowed" } };
		return {
			status: 200,
			body: {
				wire: PENDING_PROMPT_WIRE,
				// Stated, not implied — an attending device should not have to guess
				// how often it is welcome to ask.
				pollIntervalMs: hub.pollIntervalMs,
				prompts: hub.list(),
			},
		};
	}

	const answerMatch = ANSWER_PATH.exec(request.path);
	if (answerMatch) {
		if (method !== "POST") return { status: 405, body: { error: "method-not-allowed" } };
		const promptId = decodeURIComponent(answerMatch[1]!);
		const body = isRecord(request.body) ? request.body : {};
		// Only `value` is read off the body. A `device` field, if a caller sends
		// one, is ignored rather than merged — see `resolveAnsweringDevice`.
		const device = resolveAnsweringDevice(request.authenticatedDevice);
		const result = hub.answer(promptId, body.value, device);
		if (result.ok) {
			return { status: 200, body: { outcome: "answered", device: result.settlement.device } };
		}
		if (result.reason === "already-settled") {
			// 409, with WHO settled it: a peer that lost the race is told what
			// happened, because a silent drop teaches a caller to retry harder.
			return {
				status: 409,
				body: {
					error: "already-settled",
					outcome: result.settlement.outcome,
					device: result.settlement.device,
					...(result.settlement.reason ? { reason: result.settlement.reason } : {}),
				},
			};
		}
		if (result.reason === "invalid") {
			return { status: 400, body: { error: "invalid-answer", detail: result.detail } };
		}
		return { status: 404, body: { error: "unknown-prompt" } };
	}

	return { status: 404, body: { error: "not-found" } };
}
