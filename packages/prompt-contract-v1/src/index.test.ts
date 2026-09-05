import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	checkPendingPromptAnswer,
	checkPendingPromptListWire,
	checkPendingPromptWire,
	createAttendedOperatorChannel,
	createAutoOperatorChannel,
	createOperatorChannelFor,
	createPeeredOperatorChannel,
	createPendingPromptHub,
	createRemoteOperatorChannel,
	createScriptedOperatorChannel,
	createStdioOperatorChannel,
	createTerminalOperatorChannel,
	currentPromptPublisher,
	handlePendingPromptHttp,
	NODE_LOCAL_PROMPT_DEVICE,
	normalizeNoticeInput,
	OPERATOR_NOTICE_WIRE,
	OperatorPromptCancelledError,
	OperatorPromptExpiredError,
	optionCapacityFor,
	parseOperatorNotice,
	parseOperatorNoticeList,
	parseOperatorPrompt,
	parsePendingPrompt,
	parsePendingPromptList,
	PENDING_PROMPT_WIRE,
	PROMPT_CAPABILITY,
	readDeclaredPendingPromptWire,
	RESERVED_PROMPT_DEVICES,
	resolveAnsweringDevice,
	runOperatorChannelConformance,
	setPromptPublisher,
	TERMINAL_PROMPT_DEVICE,
	textPromptHint,
	toPendingPrompt,
	visibleOptionWindow,
	type OperatorChannel,
	type OperatorNotice,
	type OperatorPrompt,
	type PendingPromptHub,
	type PromptPublisher,
} from "./index.js";

function makeTtyIo() {
	const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
	const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
	let outputText = "";
	let paused = true;
	let pauseCalls = 0;
	let rawMode: boolean | undefined;

	input.isTTY = true;
	input.isRaw = false;
	input.isPaused = () => paused;
	input.resume = () => {
		paused = false;
		// Forward to the real Readable so byte-level writes/end() still flow through
		// Node's own stream + keypress-decoding machinery (needed by tests that drive
		// the prompt via `input.write(...)`/`input.end()` instead of a synthetic
		// `emit("keypress", ...)`) — the flags above still track calls for assertions.
		PassThrough.prototype.resume.call(input);
		return input;
	};
	input.pause = () => {
		paused = true;
		pauseCalls += 1;
		PassThrough.prototype.pause.call(input);
		return input;
	};
	input.setRawMode = (value: boolean) => {
		rawMode = value;
		input.isRaw = value;
		return input;
	};
	output.isTTY = true;
	output.on("data", (chunk) => {
		outputText += String(chunk);
	});

	return {
		input,
		output,
		state: {
			get paused() {
				return paused;
			},
			get pauseCalls() {
				return pauseCalls;
			},
			get rawMode() {
				return rawMode;
			},
			get outputText() {
				return outputText;
			},
		},
	};
}

/** A TTY-flavored input WITHOUT `setRawMode` — forces `askSelect` down the plain
 * numbered (readline `rl.question`) path instead of the raw-mode TUI, so SIGINT/EOF
 * cancellation on the `rl.question`-based prompts (confirm/select-numbered/text) can
 * be exercised for `select` too, not just its TUI sibling. */
function makeLineModeTtyIo() {
	const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
	const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
	input.isTTY = true;
	output.isTTY = true;
	output.on("data", () => {});
	return { input, output };
}

/** Flush pending microtasks (promise chains spanning several `await` hops) before
 * the next simulated keystroke — needed because a single readline round-trip
 * resolves across multiple microtask turns. `setImmediate` runs after ALL pending
 * microtasks drain, so one flush is enough regardless of chain depth. */
function tick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("PROMPT_CAPABILITY", () => {
	it("is prompt:v1", () => {
		expect(PROMPT_CAPABILITY).toBe("prompt:v1");
	});
});

describe("createAutoOperatorChannel", () => {
	it("returns default for confirm (false)", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "confirm", question: "ok?", default: false })).toBe(false);
	});

	it("returns true when no default on confirm", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "confirm", question: "ok?" })).toBe(true);
	});

	it("returns default for select", async () => {
		const ch = createAutoOperatorChannel();
		const opts = [
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		];
		expect(await ch.ask({ type: "select", question: "pick", options: opts, default: "b" })).toBe(
			"b",
		);
	});

	it("returns first option when no default on select", async () => {
		const ch = createAutoOperatorChannel();
		const opts = [
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		];
		expect(await ch.ask({ type: "select", question: "pick", options: opts })).toBe("a");
	});

	it("returns empty string when select has no options", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "select", question: "pick", options: [] })).toBe("");
	});

	it("returns default for text", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "text", question: "name?", default: "alice" })).toBe("alice");
	});

	it("returns empty string when no default on text", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "text", question: "name?" })).toBe("");
	});

	it("returns empty string for secret prompts", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "secret", question: "key?" })).toBe("");
	});
});

describe("createScriptedOperatorChannel", () => {
	it("returns answers in sequence", async () => {
		const ch = createScriptedOperatorChannel([true, "openai", "sk-test"]);
		const opts = [
			{ value: "openai", label: "OpenAI" },
			{ value: "anthropic", label: "Anthropic" },
		];
		expect(await ch.ask({ type: "confirm", question: "ok?" })).toBe(true);
		expect(await ch.ask({ type: "select", question: "provider?", options: opts })).toBe("openai");
		expect(await ch.ask({ type: "secret", question: "key?" })).toBe("sk-test");
	});

	it("throws RangeError when answers are exhausted", async () => {
		const ch = createScriptedOperatorChannel([]);
		await expect(ch.ask({ type: "confirm", question: "ok?" })).rejects.toThrow(RangeError);
	});

	it("works with a single answer", async () => {
		const ch = createScriptedOperatorChannel([false]);
		expect(await ch.ask({ type: "confirm", question: "proceed?" })).toBe(false);
	});
});

describe("createStdioOperatorChannel", () => {
	it("separates each prompt from the preceding terminal trace by default", async () => {
		const { input, output, state } = makeTtyIo();
		const answer = createStdioOperatorChannel({ input, output }).ask({
			type: "text",
			question: "Next step",
		});
		input.write("done\n");
		await expect(answer).resolves.toBe("done");
		expect(state.outputText.startsWith("\n")).toBe(true);
		expect(state.outputText).toContain("Next step: ");
	});

	it("lets a host preserve the trace or clear the screen between steps", async () => {
		const preserved = makeTtyIo();
		const preservedAnswer = createStdioOperatorChannel({
			input: preserved.input,
			output: preserved.output,
			transition: "preserve",
		}).ask({ type: "text", question: "Compact" });
		preserved.input.write("ok\n");
		await preservedAnswer;
		expect(preserved.state.outputText.startsWith("\n")).toBe(false);
		expect(preserved.state.outputText).toContain("Compact: ");

		const cleared = makeTtyIo();
		const clearedAnswer = createStdioOperatorChannel({
			input: cleared.input,
			output: cleared.output,
			transition: "clear",
		}).ask({ type: "text", question: "Fresh" });
		cleared.input.write("ok\n");
		await clearedAnswer;
		expect(cleared.state.outputText.startsWith("\x1b[2J\x1b[H")).toBe(true);
		expect(cleared.state.outputText).toContain("Fresh: ");
	});

	it("keeps every secret frame inside the row, so a narrow terminal cannot keep its tail", async () => {
		// The operator pasted a device token into Termux and the prompt reprinted itself
		// once per character: on a phone the line is wider than the row, so `clearLine` +
		// `cursorTo(0)` only erased the LAST wrapped row and every earlier one survived —
		// each carrying its own `visibleTail`. What stayed on screen was a sliding window
		// of the secret, which reconstructs the whole of it.
		//
		// A frame that fits the row is erased by the next one. That is the property.
		const { input, output, state } = makeTtyIo();
		output.columns = 40;
		const channel = createStdioOperatorChannel({ input, output });
		const secret = "sk-live-abcdefghijklmnopqrstuvwxyz012345";
		const result = channel.ask({
			type: "secret",
			question: "Cole a credencial deste aparelho",
			visibleTail: 4,
		});

		for (const character of secret) input.emit("keypress", character, { name: character });
		input.emit("keypress", "", { name: "return" });
		await expect(result).resolves.toBe(secret);

		// Strip the control sequences; what remains is what the row had to hold.
		const frames = state.outputText
			.split(/\u001b\[[0-9;]*[A-Za-z]/)
			.map((frame) => frame.replace(/\n/g, ""))
			.filter((frame) => frame.length > 0);
		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) {
			expect(frame.length).toBeLessThanOrEqual(40);
		}
	});


	it("counts the rows a select actually occupies, not the lines it meant to write", async () => {
		// The operator navigated a select in Termux and the whole prompt reprinted on every
		// keypress. `renderedLines` counted LOGICAL lines while `moveCursor` moves PHYSICAL
		// rows: on a narrow terminal a long option wraps, so the cursor rose fewer rows than
		// the render had consumed, `clearScreenDown` erased from the middle, and everything
		// above survived — once per keystroke.
		//
		// Same family as the secret mask: a redraw that assumes one row per line.
		const { input, output, state } = makeTtyIo();
		output.columns = 20;
		const channel = createStdioOperatorChannel({ input, output });
		const answer = channel.ask({
			type: "select",
			question: "Por onde?",
			options: [
				{ value: "a", label: "uma opcao bem longa que nao cabe numa fileira so" },
				{ value: "b", label: "outra opcao igualmente longa para forcar a quebra" },
			],
		});

		input.emit("keypress", "", { name: "down" });
		input.emit("keypress", "", { name: "return" });
		await expect(answer).resolves.toBe("b");

		// The redraw must climb at least as many rows as the first render occupied.
		const climbs = [...state.outputText.matchAll(/\[(\d+)A/g)].map((m) => Number(m[1]));
		expect(climbs.length).toBeGreaterThan(0);
		expect(Math.max(...climbs)).toBeGreaterThanOrEqual(6);
	});

	it("restores paused stdin after a raw-mode secret prompt", async () => {
		const { input, output, state } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "secret", question: "token" });

		input.emit("keypress", "a", { name: "a" });
		input.emit("keypress", "", { name: "return" });

		await expect(result).resolves.toBe("a");
		expect(state.paused).toBe(true);
		expect(state.pauseCalls).toBe(1);
		expect(state.rawMode).toBe(false);
	});

	it("restores paused stdin after a raw-mode select prompt", async () => {
		const originalNoColor = process.env.NO_COLOR;
		delete process.env.NO_COLOR;
		const { input, output, state } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		try {
			const result = channel.ask({
				type: "select",
				question: "provider",
				options: [
					{ value: "openai", label: "OpenAI", description: "Primary provider" },
					{ value: "anthropic", label: "Anthropic" },
				],
				default: "openai",
			});

			input.emit("keypress", "", { name: "down" });
			input.emit("keypress", "", { name: "return" });

			await expect(result).resolves.toBe("anthropic");
			expect(state.paused).toBe(true);
			expect(state.pauseCalls).toBe(1);
			expect(state.rawMode).toBe(false);
			expect(state.outputText).toContain("\x1b[7m");
			expect(state.outputText).toContain("\x1b[1G");
			expect(state.outputText).toContain("OpenAI - Primary provider");
			expect(state.outputText).not.toContain("OpenAI  - Primary provider");
		} finally {
			if (originalNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = originalNoColor;
			}
		}
	});

	it("restores paused stdin after cancelling a raw-mode select prompt", async () => {
		const { input, output, state } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({
			type: "select",
			question: "provider",
			options: [{ value: "openai", label: "OpenAI" }],
			default: "openai",
		});

		input.emit("keypress", "\u0003", { ctrl: true, name: "c" });

		await expect(result).rejects.toThrow("Operator prompt cancelled");
		expect(state.paused).toBe(true);
		expect(state.pauseCalls).toBe(1);
		expect(state.rawMode).toBe(false);
	});

	// ── Cancellation: SIGINT (Ctrl+C) ────────────────────────────────────────

	it("rejects a confirm prompt with OperatorPromptCancelledError on SIGINT", async () => {
		const { input, output } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "confirm", question: "proceed?" });

		input.emit("keypress", "", { ctrl: true, name: "c" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("rejects a numbered select prompt with OperatorPromptCancelledError on SIGINT", async () => {
		const { input, output } = makeLineModeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({
			type: "select",
			question: "provider",
			options: [{ value: "openai", label: "OpenAI" }],
		});

		input.emit("keypress", "", { ctrl: true, name: "c" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("rejects a text prompt with OperatorPromptCancelledError on SIGINT (the reported defect)", async () => {
		// This is exactly the device-label prompt from `refarm auth enroll`: the
		// operator's Ctrl+C left it as an unsettled promise (an "unsettled
		// top-level await" warning) because askText had no reject path at all.
		const { input, output } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "text", question: "Label for the new device" });

		input.emit("keypress", "", { ctrl: true, name: "c" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("rejects a raw-mode secret prompt with OperatorPromptCancelledError on SIGINT", async () => {
		const { input, output, state } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "secret", question: "token" });

		input.emit("keypress", "", { ctrl: true, name: "c" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
		expect(state.paused).toBe(true);
		expect(state.rawMode).toBe(false);
	});

	// ── Cancellation: stdin EOF (Ctrl+D / piped stdin closing) ──────────────────

	it("rejects a confirm prompt with OperatorPromptCancelledError on Ctrl+D", async () => {
		const { input, output } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "confirm", question: "proceed?" });

		input.emit("keypress", "", { ctrl: true, name: "d" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("rejects a confirm prompt with OperatorPromptCancelledError when stdin actually closes (piped EOF)", async () => {
		const { input, output } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "confirm", question: "proceed?" });

		input.end();

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("rejects a numbered select prompt with OperatorPromptCancelledError on Ctrl+D", async () => {
		const { input, output } = makeLineModeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({
			type: "select",
			question: "provider",
			options: [{ value: "openai", label: "OpenAI" }],
		});

		input.emit("keypress", "", { ctrl: true, name: "d" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("rejects a text prompt with OperatorPromptCancelledError on Ctrl+D", async () => {
		const { input, output } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "text", question: "Label for the new device" });

		input.emit("keypress", "", { ctrl: true, name: "d" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("rejects a text prompt with OperatorPromptCancelledError when stdin actually closes (piped EOF)", async () => {
		const { input, output } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "text", question: "Label for the new device" });

		input.end();

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("rejects a raw-mode select (TUI) prompt with OperatorPromptCancelledError on Ctrl+D", async () => {
		const { input, output, state } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({
			type: "select",
			question: "provider",
			options: [{ value: "openai", label: "OpenAI" }],
		});

		input.emit("keypress", "", { ctrl: true, name: "d" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
		expect(state.rawMode).toBe(false);
	});

	it("rejects a raw-mode secret prompt with OperatorPromptCancelledError on Ctrl+D", async () => {
		const { input, output, state } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const result = channel.ask({ type: "secret", question: "token" });

		input.emit("keypress", "", { ctrl: true, name: "d" });

		await expect(result).rejects.toBeInstanceOf(OperatorPromptCancelledError);
		expect(state.rawMode).toBe(false);
	});

	// ── No listener/raw-mode leak across sequential prompts ──────────────────

	it("leaves no keypress listener behind on the shared input after a cancelled raw-mode prompt, or a completed one", async () => {
		const { input, output, state } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });
		const baseline = input.listenerCount("keypress");

		const cancelled = channel.ask({
			type: "select",
			question: "pick",
			options: [{ value: "a", label: "A" }],
		});
		input.emit("keypress", "", { ctrl: true, name: "c" });
		await expect(cancelled).rejects.toBeInstanceOf(OperatorPromptCancelledError);
		expect(input.listenerCount("keypress")).toBe(baseline);
		expect(state.rawMode).toBe(false);

		const completed = channel.ask({
			type: "select",
			question: "pick again",
			options: [{ value: "a", label: "A" }],
		});
		input.emit("keypress", "", { name: "return" });
		await expect(completed).resolves.toBe("a");
		expect(input.listenerCount("keypress")).toBe(baseline);
		expect(state.rawMode).toBe(false);
	});

	it("does not let a cancelled prompt's SIGINT/close handling leak onto the next prompt", async () => {
		// A leaked handler from a cancelled prompt would double-fire (or otherwise
		// interfere with) the NEXT prompt sharing the same input/output — this drives
		// two prompts back to back and checks the second behaves exactly as if the
		// first had never happened.
		const { input, output } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });

		const cancelled = channel.ask({ type: "text", question: "device label" });
		input.emit("keypress", "", { ctrl: true, name: "c" });
		await expect(cancelled).rejects.toBeInstanceOf(OperatorPromptCancelledError);

		const second = channel.ask({ type: "confirm", question: "proceed?", default: true });
		input.write("y\n");
		await expect(second).resolves.toBe(true);
	});
});

describe("runOperatorChannelConformance", () => {
	it("passes for createAutoOperatorChannel", async () => {
		const result = await runOperatorChannelConformance(createAutoOperatorChannel());
		expect(result.pass).toBe(true);
		expect(result.total).toBeGreaterThanOrEqual(5);
		expect(result.failures).toEqual([]);
	});

	it("passes for createScriptedOperatorChannel with matching answers", async () => {
		// Conformance asks: confirm(default:true), select(default:"a"), text(default:"hello"),
		// secret, then a 5th text prompt for the cancellation check. createScriptedOperatorChannel
		// has no cancellable I/O (no triggerCancel passed below), so that 5th ask() just needs a
		// canned answer like any other — it settles immediately either way.
		const ch = createScriptedOperatorChannel([true, "a", "hello", "secret", "n/a"]);
		const result = await runOperatorChannelConformance(ch);
		expect(result.pass).toBe(true);
	});

	it("does not require createAutoOperatorChannel/createScriptedOperatorChannel to reject on cancellation", async () => {
		// Neither channel waits on external input, so there is no window for a
		// SIGINT/EOF to interrupt — conformance must not penalize them for that.
		// (Covered functionally above; this documents the contract explicitly.)
		const autoResult = await runOperatorChannelConformance(createAutoOperatorChannel());
		expect(autoResult.failures.some((f) => f.includes("cancellation"))).toBe(false);

		const scripted = createScriptedOperatorChannel([true, "a", "hello", "secret", "n/a"]);
		const scriptedResult = await runOperatorChannelConformance(scripted);
		expect(scriptedResult.failures.some((f) => f.includes("cancellation"))).toBe(false);
	});

	it("fails a channel whose ask() never settles on cancellation", async () => {
		// Answers the first 4 (ordinary, un-cancelled) conformance checks normally —
		// so this exercises ONLY the cancellation check, not "every ask() hangs" —
		// then never settles the 5th, reproducing the pre-fix bug (an unsettled
		// prompt promise) exactly where conformance is supposed to catch it.
		let calls = 0;
		const neverSettlesOnCancel: OperatorChannel = {
			ask: ((prompt) => {
				calls += 1;
				if (calls > 4) return new Promise(() => {});
				if (prompt.type === "confirm") return Promise.resolve(true);
				if (prompt.type === "select") return Promise.resolve(prompt.options[0]?.value ?? "");
				return Promise.resolve("ok");
			}) as OperatorChannel["ask"],
		};

		const result = await runOperatorChannelConformance(neverSettlesOnCancel, {
			triggerCancel: () => {},
		});

		expect(result.pass).toBe(false);
		expect(result.failures.some((f) => f.includes("cancellation"))).toBe(true);
	});

	it("fails a channel that resolves instead of rejecting with OperatorPromptCancelledError on cancellation", async () => {
		const ignoresCancel: OperatorChannel = {
			ask: (() => Promise.resolve("ignored the cancel")) as OperatorChannel["ask"],
		};

		const result = await runOperatorChannelConformance(ignoresCancel, { triggerCancel: () => {} });

		expect(result.pass).toBe(false);
		expect(result.failures.some((f) => f.includes("cancellation"))).toBe(true);
	});

	it("passes the real createStdioOperatorChannel end to end, including a real cancellation", async () => {
		const { input, output } = makeTtyIo();
		const channel = createStdioOperatorChannel({ input, output });

		const resultPromise = runOperatorChannelConformance(channel, {
			triggerCancel: () => input.emit("keypress", "", { ctrl: true, name: "c" }),
		});

		// Drive the four ordinary checks (confirm, select, text, secret) exactly like a
		// terminal would: raw bytes decode into readline keypresses for both the
		// `rl.question`-based prompts and the raw-mode TUI ones (select/secret here,
		// since `makeTtyIo` provides `setRawMode`). `tick()` between each answer lets
		// every microtask hop of the previous prompt's settling finish before the next
		// prompt's listeners are attached.
		await tick();
		input.write("y\n"); // 1 — confirm
		await tick();
		input.write("\n"); // 2 — select (TUI): Enter accepts the default
		await tick();
		input.write("hello\n"); // 3 — text
		await tick();
		input.write("secret\n"); // 4 — secret (raw mode: Enter submits)
		await tick();
		// 5 — cancellation: runOperatorChannelConformance calls triggerCancel itself.

		const result = await resultPromise;
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

// ── The pending prompt on the wire ────────────────────────────────────────────

const ASKER = { command: "refarm auth enrol", pid: 4242, host: "serpro-1577853" };

function pendingOf(prompt: OperatorPrompt, id = "p-1", timeoutMs: number | null = null) {
	return toPendingPrompt(prompt, { id, asker: ASKER, askedAt: 1_000, timeoutMs });
}

/** JSON is the only thing the wire actually carries — round-trip through it,
 *  never through a structured clone that would hide a non-serialisable field. */
function overWire<T>(value: T): unknown {
	return JSON.parse(JSON.stringify(value));
}

describe("PendingPrompt wire shape", () => {
	it("round-trips every prompt kind through JSON", () => {
		const prompts: OperatorPrompt[] = [
			{ type: "confirm", question: "Proceed?", default: false },
			{
				type: "select",
				question: "Which node?",
				options: [
					{ value: "a", label: "A", description: "the first" },
					{ value: "b", label: "B" },
				],
				default: "b",
			},
			{ type: "text", question: "Farm name?", default: "serpro", placeholder: "MagicDNS" },
			{ type: "secret", question: "VPN password?", visibleTail: 2 },
		];
		for (const prompt of prompts) {
			const pending = pendingOf(prompt);
			expect(parsePendingPrompt(overWire(pending))).toEqual(pending);
		}
	});

	it("marks a secret prompt as travelling, and nothing else (P4)", () => {
		expect(pendingOf({ type: "secret", question: "token?" }).answerTravels).toBe(true);
		expect(pendingOf({ type: "text", question: "name?" }).answerTravels).toBe(false);
		expect(pendingOf({ type: "confirm", question: "ok?" }).answerTravels).toBe(false);
		expect(
			pendingOf({ type: "select", question: "which?", options: [{ value: "a", label: "A" }] })
				.answerTravels,
		).toBe(false);
	});

	it("recomputes answerTravels on parse — a peer cannot strip the P4 warning", () => {
		const pending = pendingOf({ type: "secret", question: "VPN password?" });
		const tampered = { ...(overWire(pending) as object), answerTravels: false };
		expect(parsePendingPrompt(tampered)?.answerTravels).toBe(true);
	});

	it("carries the asker's deadline, or null when there is none (P5)", () => {
		expect(pendingOf({ type: "text", question: "q" }, "p-1", null).expiresAt).toBeNull();
		expect(pendingOf({ type: "text", question: "q" }, "p-1", 5_000).expiresAt).toBe(6_000);
	});

	it("rejects malformed wire values instead of trusting them", () => {
		const good = overWire(pendingOf({ type: "text", question: "q" })) as Record<string, unknown>;
		expect(parsePendingPrompt(null)).toBeNull();
		expect(parsePendingPrompt("nope")).toBeNull();
		expect(parsePendingPrompt({ ...good, wire: "pending-prompt.v2" })).toBeNull();
		expect(parsePendingPrompt({ ...good, id: "" })).toBeNull();
		expect(parsePendingPrompt({ ...good, prompt: { type: "wat", question: "q" } })).toBeNull();
		expect(parsePendingPrompt({ ...good, prompt: { type: "text" } })).toBeNull();
		expect(parsePendingPrompt({ ...good, asker: {} })).toBeNull();
		expect(parsePendingPrompt({ ...good, askedAt: "soon" })).toBeNull();
		expect(parsePendingPrompt({ ...good, expiresAt: "later" })).toBeNull();
		// A select with no options is not a question anybody can answer.
		expect(
			parsePendingPrompt({ ...good, prompt: { type: "select", question: "q", options: [] } }),
		).toBeNull();
	});

	it("drops unparseable entries from a list instead of failing the whole list", () => {
		const ok = overWire(pendingOf({ type: "text", question: "q" }, "p-ok"));
		expect(parsePendingPromptList({ prompts: [ok, { junk: true }, null] })).toHaveLength(1);
		expect(parsePendingPromptList({})).toEqual([]);
		expect(parsePendingPromptList(null)).toEqual([]);
	});

	it("drops a select default that is not one of the options", () => {
		const parsed = parseOperatorPrompt({
			type: "select",
			question: "q",
			options: [{ value: "a", label: "A" }],
			default: "ghost",
		});
		expect(parsed).toEqual({ type: "select", question: "q", options: [{ value: "a", label: "A" }] });
	});
});

describe("the declared wire version, checked", () => {
	/** The envelope the node serves TODAY, byte-for-byte as `GET /prompts` returns it.
	 *  Pinned as a literal rather than built from the constant on purpose: this is the
	 *  shape the operator's phone is talking to right now, and a change to it must break
	 *  a test here rather than a device in a pocket. */
	const LIVE_ENVELOPE = { pollIntervalMs: 2000, prompts: [], wire: "pending-prompt.v1" };

	it("says compatible for the envelope the node serves today", () => {
		expect(checkPendingPromptListWire(LIVE_ENVELOPE)).toEqual({
			verdict: "compatible",
			declared: "pending-prompt.v1",
			expected: PENDING_PROMPT_WIRE,
		});
	});

	it("says incompatible — never compatible — for a version this side does not speak", () => {
		const check = checkPendingPromptListWire({ ...LIVE_ENVELOPE, wire: "pending-prompt.v2" });
		expect(check.verdict).toBe("incompatible");
		expect(check.declared).toBe("pending-prompt.v2");
		expect(check.expected).toBe(PENDING_PROMPT_WIRE);
	});

	it("says unknown — never compatible — when the peer declared nothing", () => {
		// THE mutation this suite exists to catch. A peer that declared nothing has not
		// agreed to anything, and recording that as `compatible` is exactly the silent
		// break the check was added to stop.
		for (const body of [
			{ pollIntervalMs: 2000, prompts: [] }, // an older node: no field at all
			{ ...LIVE_ENVELOPE, wire: "" }, // a blank field is not a version
			{ ...LIVE_ENVELOPE, wire: 1 }, // nor is a number
			{ ...LIVE_ENVELOPE, wire: null },
			null,
			"not an object",
		]) {
			const check = checkPendingPromptListWire(body);
			expect(check.verdict).toBe("unknown");
			expect(check.verdict).not.toBe("compatible");
			expect(check.declared).toBeNull();
		}
	});

	it("compares by exact match, so a near-miss is a refusal and not a guess", () => {
		// No semver rule, no prefix rule, no case folding. The discriminator moves only
		// for a breaking change, so every difference in it IS breaking.
		for (const near of [
			"pending-prompt.v1 ",
			"Pending-Prompt.v1",
			"pending-prompt.v1.1",
			"pending-prompt.v10",
			"pending-prompt",
		]) {
			expect(checkPendingPromptWire(near).verdict).toBe("incompatible");
		}
		expect(checkPendingPromptWire(PENDING_PROMPT_WIRE).verdict).toBe("compatible");
	});

	it("reads the declared version off an envelope, or null", () => {
		expect(readDeclaredPendingPromptWire(LIVE_ENVELOPE)).toBe("pending-prompt.v1");
		expect(readDeclaredPendingPromptWire({ prompts: [] })).toBeNull();
		expect(readDeclaredPendingPromptWire([{ wire: "pending-prompt.v1" }])).toBeNull();
	});

	it("what the node serves and what this side expects are the SAME constant", () => {
		// The end of the defect: the version is declared here and read here.
		const hub = createPendingPromptHub();
		hub.publish(pendingOf({ type: "text", question: "Farm name?" }));
		const served = handlePendingPromptHttp(hub, { method: "GET", path: "/prompts" });
		expect(checkPendingPromptListWire(served.body).verdict).toBe("compatible");
	});
});

describe("checkPendingPromptAnswer", () => {
	it("holds a select to the options it offered", () => {
		const prompt: OperatorPrompt = {
			type: "select",
			question: "q",
			options: [{ value: "a", label: "A" }],
		};
		expect(checkPendingPromptAnswer(prompt, "a")).toEqual({ ok: true, value: "a" });
		expect(checkPendingPromptAnswer(prompt, "z").ok).toBe(false);
		expect(checkPendingPromptAnswer(prompt, 1).ok).toBe(false);
	});

	it("accepts a boolean or its usual spellings for confirm", () => {
		const prompt: OperatorPrompt = { type: "confirm", question: "q" };
		expect(checkPendingPromptAnswer(prompt, true)).toEqual({ ok: true, value: true });
		expect(checkPendingPromptAnswer(prompt, "no")).toEqual({ ok: true, value: false });
		expect(checkPendingPromptAnswer(prompt, "Y")).toEqual({ ok: true, value: true });
		expect(checkPendingPromptAnswer(prompt, "maybe").ok).toBe(false);
	});

	it("never quotes the submitted value in a rejection — that is where a secret would leak", () => {
		const result = checkPendingPromptAnswer({ type: "secret", question: "q" }, 12345);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).not.toContain("12345");
	});
});

describe("resolveAnsweringDevice", () => {
	it("records the identity the gate resolved", () => {
		expect(resolveAnsweringDevice("pixel-7")).toBe("pixel-7");
	});

	it("records an unauthenticated caller as node-local", () => {
		expect(resolveAnsweringDevice(null)).toBe(NODE_LOCAL_PROMPT_DEVICE);
		expect(resolveAnsweringDevice(undefined)).toBe(NODE_LOCAL_PROMPT_DEVICE);
		expect(resolveAnsweringDevice("   ")).toBe(NODE_LOCAL_PROMPT_DEVICE);
	});

	it("cannot be talked into a reserved identity — they are unreachable by trimming", () => {
		for (const reserved of RESERVED_PROMPT_DEVICES) {
			expect(resolveAnsweringDevice(reserved)).toBe(reserved.trim());
			expect(RESERVED_PROMPT_DEVICES).not.toContain(reserved.trim());
		}
	});
});

// ── The races. Exactly one answer may settle a prompt. ────────────────────────

describe("createPendingPromptHub", () => {
	it("lists what is pending and forgets it the moment it settles (P1)", () => {
		const hub = createPendingPromptHub();
		const ticket = hub.publish(pendingOf({ type: "text", question: "q" }));
		expect(hub.list().map((p) => p.id)).toEqual(["p-1"]);
		hub.answer("p-1", "answer", "pixel-7");
		expect(hub.list()).toEqual([]);
		return expect(ticket.settled).resolves.toMatchObject({ value: "answer" });
	});

	it("lets exactly one of two simultaneous devices win (P2)", async () => {
		const hub = createPendingPromptHub();
		const ticket = hub.publish(pendingOf({ type: "text", question: "q" }));

		// Both submissions in the SAME tick — the shape of two operators tapping
		// at once, which is the race the rule exists for.
		const results = [hub.answer("p-1", "from-pixel", "pixel-7"), hub.answer("p-1", "from-tablet", "tablet-1")];

		expect(results.filter((r) => r.ok)).toHaveLength(1);
		const loser = results.find((r) => !r.ok)!;
		expect(loser).toMatchObject({ ok: false, reason: "already-settled" });
		expect(loser.ok === false && loser.reason === "already-settled" && loser.settlement.device).toBe(
			"pixel-7",
		);
		await expect(ticket.settled).resolves.toMatchObject({ value: "from-pixel" });
	});

	it("tells a device that lost to the terminal WHO settled it, not just 404", async () => {
		const hub = createPendingPromptHub();
		const ticket = hub.publish(pendingOf({ type: "text", question: "q" }));
		ticket.withdraw("cancelled", TERMINAL_PROMPT_DEVICE);

		const late = hub.answer("p-1", "too late", "pixel-7");
		expect(late).toMatchObject({
			ok: false,
			reason: "already-settled",
			settlement: { outcome: "abandoned", device: TERMINAL_PROMPT_DEVICE, reason: "cancelled" },
		});
	});

	it("reports a prompt it never knew as unknown, not as settled", () => {
		expect(createPendingPromptHub().answer("ghost", "x", "pixel-7")).toEqual({
			ok: false,
			reason: "unknown",
		});
	});

	it("refuses an answer the prompt's own constraints reject", () => {
		const hub = createPendingPromptHub();
		hub.publish(
			pendingOf({ type: "select", question: "q", options: [{ value: "a", label: "A" }] }),
		);
		expect(hub.answer("p-1", "z", "pixel-7")).toMatchObject({ ok: false, reason: "invalid" });
		// Still pending: a rejected answer settles nothing.
		expect(hub.list()).toHaveLength(1);
	});

	it("withdraws idempotently — an asker dying twice is not two settlements", () => {
		const hub = createPendingPromptHub();
		const ticket = hub.publish(pendingOf({ type: "text", question: "q" }));
		expect(ticket.withdraw()).toBe(true);
		expect(ticket.withdraw()).toBe(false);
	});

	it("refuses to grow an unbounded queue of questions nobody will see", () => {
		const hub = createPendingPromptHub({ maxPending: 2 });
		hub.publish(pendingOf({ type: "text", question: "q" }, "p-1"));
		hub.publish(pendingOf({ type: "text", question: "q" }, "p-2"));
		expect(() => hub.publish(pendingOf({ type: "text", question: "q" }, "p-3"))).toThrow(
			/refusing to queue more/,
		);
	});

	it("bounds what it remembers about settled prompts", () => {
		const hub = createPendingPromptHub({ recentSettlements: 1 });
		hub.publish(pendingOf({ type: "text", question: "q" }, "p-1"));
		hub.publish(pendingOf({ type: "text", question: "q" }, "p-2"));
		hub.answer("p-1", "a", "pixel-7");
		hub.answer("p-2", "b", "pixel-7");
		expect(hub.settlementOf("p-2")).not.toBeNull();
		expect(hub.settlementOf("p-1")).toBeNull();
	});

	it("carries no answer value in a settlement — the safe-to-show record stays safe (P4)", () => {
		const hub = createPendingPromptHub();
		hub.publish(pendingOf({ type: "secret", question: "VPN password?" }));
		const result = hub.answer("p-1", "hunter2-do-not-log", "pixel-7");
		expect(JSON.stringify(result.ok && result.settlement)).not.toContain("hunter2");
		expect(JSON.stringify(hub.settlementOf("p-1"))).not.toContain("hunter2");
	});

	it("notifies subscribers on publish", () => {
		const hub = createPendingPromptHub();
		const seen: string[] = [];
		const off = hub.subscribe((p) => seen.push(p.id));
		hub.publish(pendingOf({ type: "text", question: "q" }, "p-1"));
		off();
		hub.publish(pendingOf({ type: "text", question: "q" }, "p-2"));
		expect(seen).toEqual(["p-1"]);
	});
});

// ── The remote channel, and local/remote as peers ─────────────────────────────

/** A channel whose single in-flight `ask()` the test settles by hand, and which
 *  honours the abort signal exactly as the stdio channel does. Stands in for the
 *  terminal without needing a fake TTY per test. */
function makeControllableChannel() {
	let resolveAsk: ((value: boolean | string) => void) | null = null;
	let rejectAsk: ((error: unknown) => void) | null = null;
	const create = (signal: AbortSignal): OperatorChannel => ({
		ask: ((_prompt: OperatorPrompt) =>
			new Promise<boolean | string>((resolve, reject) => {
				resolveAsk = resolve;
				rejectAsk = reject;
				signal.addEventListener("abort", () => reject(new OperatorPromptCancelledError()), {
					once: true,
				});
			})) as OperatorChannel["ask"],
	});
	return {
		create,
		answer: (value: boolean | string) => resolveAsk?.(value),
		fail: (error: unknown) => rejectAsk?.(error),
	};
}

/** An attending device that answers whatever appears — the phone, in a test. */
function attend(hub: PendingPromptHub, device = "pixel-7") {
	return hub.subscribe((pending) => {
		// The conformance suite's cancellation check must be left to be cancelled;
		// answering it would settle the very prompt whose interruption is under test.
		if (pending.prompt.question === "_conformance_cancel_") return;
		queueMicrotask(() => {
			const prompt = pending.prompt;
			const value =
				prompt.type === "confirm"
					? true
					: prompt.type === "select"
						? prompt.options[0]!.value
						: "attended";
			hub.answer(pending.id, value, device);
		});
	});
}

describe("createRemoteOperatorChannel", () => {
	it("returns the value an attending device submitted, and records which one (P3)", async () => {
		const hub = createPendingPromptHub();
		const channel = createRemoteOperatorChannel({ hub, asker: ASKER });
		const pendingAsk = channel.ask({ type: "text", question: "Farm name?" });
		await tick();
		const [published] = hub.list();
		expect(published?.asker.command).toBe("refarm auth enrol");
		hub.answer(published!.id, "serpro-1577853", "pixel-7");
		await expect(pendingAsk).resolves.toBe("serpro-1577853");
		expect(channel.lastSettlement()).toMatchObject({ outcome: "answered", device: "pixel-7" });
	});

	it("holds the answer to the prompt's constraints, wherever it came from", async () => {
		const hub = createPendingPromptHub();
		const channel = createRemoteOperatorChannel({ hub, asker: ASKER });
		const pendingAsk = channel.ask({
			type: "select",
			question: "Which?",
			options: [{ value: "a", label: "A" }],
		});
		await tick();
		const id = hub.list()[0]!.id;
		expect(hub.answer(id, "z", "pixel-7")).toMatchObject({ ok: false, reason: "invalid" });
		hub.answer(id, "a", "pixel-7");
		await expect(pendingAsk).resolves.toBe("a");
	});

	it("expires into a distinct outcome the asker can handle, never a hang (P5)", async () => {
		const hub = createPendingPromptHub();
		const channel = createRemoteOperatorChannel({ hub, asker: ASKER, timeoutMs: 20 });
		await expect(channel.ask({ type: "text", question: "q" })).rejects.toBeInstanceOf(
			OperatorPromptExpiredError,
		);
		// An expired question is not still on offer.
		expect(hub.list()).toEqual([]);
		expect(channel.lastSettlement()).toMatchObject({ outcome: "abandoned", reason: "expired" });
	});

	it("is cancellable by its signal, rejecting exactly as a Ctrl+C does", async () => {
		const hub = createPendingPromptHub();
		const abort = new AbortController();
		const channel = createRemoteOperatorChannel({ hub, asker: ASKER, signal: abort.signal });
		const pendingAsk = channel.ask({ type: "text", question: "q" });
		await tick();
		abort.abort();
		await expect(pendingAsk).rejects.toBeInstanceOf(OperatorPromptCancelledError);
	});

	it("refuses a remote answer that arrives after cancellation", async () => {
		const hub = createPendingPromptHub();
		const abort = new AbortController();
		const channel = createRemoteOperatorChannel({ hub, asker: ASKER, signal: abort.signal });
		const pendingAsk = channel.ask({ type: "text", question: "q" });
		await tick();
		const id = hub.list()[0]!.id;
		abort.abort();
		await expect(pendingAsk).rejects.toBeInstanceOf(OperatorPromptCancelledError);
		expect(hub.answer(id, "too late", "pixel-7")).toMatchObject({
			ok: false,
			reason: "already-settled",
		});
	});

	it("dies with its asker — a withdrawn prompt is answerable by nobody (P1)", async () => {
		const hub = createPendingPromptHub();
		const channel = createRemoteOperatorChannel({ hub, asker: ASKER });
		const pendingAsk = channel.ask({ type: "text", question: "q" });
		await tick();
		const id = hub.list()[0]!.id;
		// The asker's process is going away mid-flight.
		expect(hub.answer(id, "x", "pixel-7").ok).toBe(true);
		await expect(pendingAsk).resolves.toBe("x");
		expect(hub.answer(id, "y", "tablet-1")).toMatchObject({
			ok: false,
			reason: "already-settled",
		});
	});
});

describe("createPeeredOperatorChannel", () => {
	function peered(hub: PendingPromptHub, local: ReturnType<typeof makeControllableChannel>, timeoutMs: number | null = null) {
		const notices: string[] = [];
		const channel = createPeeredOperatorChannel({
			local: local.create,
			remote: (signal) => createRemoteOperatorChannel({ hub, asker: ASKER, signal, timeoutMs }),
			notify: (message) => notices.push(message),
		});
		return { channel, notices };
	}

	it("settles at the terminal and withdraws the question from every device", async () => {
		const hub = createPendingPromptHub();
		const local = makeControllableChannel();
		const { channel } = peered(hub, local);
		const pendingAsk = channel.ask({ type: "text", question: "q" });
		await tick();
		const id = hub.list()[0]!.id;

		local.answer("typed-at-the-desk");
		await expect(pendingAsk).resolves.toBe("typed-at-the-desk");
		expect(hub.list()).toEqual([]);
		expect(hub.answer(id, "from-phone", "pixel-7")).toMatchObject({
			ok: false,
			reason: "already-settled",
		});
	});

	it("settles remotely, interrupts the terminal, and says which device answered (P2)", async () => {
		const hub = createPendingPromptHub();
		const local = makeControllableChannel();
		const { channel, notices } = peered(hub, local);
		const pendingAsk = channel.ask({ type: "text", question: "q" });
		await tick();

		hub.answer(hub.list()[0]!.id, "typed-on-the-phone", "pixel-7");
		await expect(pendingAsk).resolves.toBe("typed-on-the-phone");
		// The terminal is TOLD, and told by whom — silence is the failure to avoid.
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("pixel-7");
		// ...and never carries the answer itself.
		expect(notices[0]).not.toContain("typed-on-the-phone");
	});

	it("propagates a Ctrl+C at the terminal, and a remote answer after it does not apply", async () => {
		const hub = createPendingPromptHub();
		const local = makeControllableChannel();
		const { channel } = peered(hub, local);
		const pendingAsk = channel.ask({ type: "text", question: "q" });
		await tick();
		const id = hub.list()[0]!.id;

		local.fail(new OperatorPromptCancelledError());
		await expect(pendingAsk).rejects.toBeInstanceOf(OperatorPromptCancelledError);
		expect(hub.answer(id, "too late", "pixel-7")).toMatchObject({
			ok: false,
			reason: "already-settled",
		});
	});

	it("keeps the terminal prompt alive when the remote side is simply broken", async () => {
		const local = makeControllableChannel();
		const notices: string[] = [];
		const channel = createPeeredOperatorChannel({
			local: local.create,
			remote: () => ({
				ask: (() => Promise.reject(new Error("sidecar unreachable"))) as OperatorChannel["ask"],
				lastSettlement: () => null,
			}),
			notify: (message) => notices.push(message),
		});
		const pendingAsk = channel.ask({ type: "text", question: "q" });
		await tick();
		local.answer("still works");
		await expect(pendingAsk).resolves.toBe("still works");
		expect(notices).toEqual([]);
	});

	it("ends BOTH sides when the asker's own deadline passes (P5)", async () => {
		const hub = createPendingPromptHub();
		const local = makeControllableChannel();
		const { channel } = peered(hub, local, 20);
		const pendingAsk = channel.ask({ type: "text", question: "q" });
		await expect(pendingAsk).rejects.toBeInstanceOf(OperatorPromptExpiredError);
		// The terminal was released too — an expired ask leaves nothing hanging.
		local.answer("late");
		expect(hub.list()).toEqual([]);
	});

	it("interrupts a REAL stdio prompt when the answer arrives from a device", async () => {
		const hub = createPendingPromptHub();
		const io = makeLineModeTtyIo();
		const channel = createPeeredOperatorChannel({
			local: (signal) => createStdioOperatorChannel({ ...io, signal }),
			remote: (signal) => createRemoteOperatorChannel({ hub, asker: ASKER, signal }),
			notify: () => {},
		});
		const pendingAsk = channel.ask({ type: "text", question: "Farm name?" });
		await tick();
		hub.answer(hub.list()[0]!.id, "serpro-1577853", "pixel-7");
		await expect(pendingAsk).resolves.toBe("serpro-1577853");
	});

	it("still cancels locally with a real Ctrl+C while a remote peer is attending", async () => {
		const hub = createPendingPromptHub();
		const { input, output } = makeTtyIo();
		const channel = createPeeredOperatorChannel({
			local: (signal) => createStdioOperatorChannel({ input, output, signal }),
			remote: (signal) => createRemoteOperatorChannel({ hub, asker: ASKER, signal }),
			notify: () => {},
		});
		const pendingAsk = channel.ask({ type: "text", question: "Farm name?" });
		await tick();
		input.emit("keypress", "", { ctrl: true, name: "c" });
		await expect(pendingAsk).rejects.toBeInstanceOf(OperatorPromptCancelledError);
		// The question is gone from every attending device too — a cancelled ask
		// leaves nothing on offer anywhere.
		expect(hub.list()).toEqual([]);
	});
});

// ── The HTTP surface ──────────────────────────────────────────────────────────

describe("handlePendingPromptHttp", () => {
	function hubWith(prompt: OperatorPrompt = { type: "text", question: "Farm name?" }) {
		const hub = createPendingPromptHub();
		hub.publish(pendingOf(prompt));
		return hub;
	}

	it("lists pending prompts and states the interval to poll at", () => {
		const response = handlePendingPromptHttp(hubWith(), { method: "GET", path: "/prompts" });
		expect(response.status).toBe(200);
		expect(response.body.wire).toBe(PENDING_PROMPT_WIRE);
		expect(response.body.pollIntervalMs).toBeGreaterThan(0);
		expect(parsePendingPromptList(overWire(response.body))).toHaveLength(1);
	});

	it("accepts an answer from an enrolled device and records it as that device (P3)", () => {
		const hub = hubWith();
		const response = handlePendingPromptHttp(hub, {
			method: "POST",
			path: "/prompts/p-1/answer",
			body: { value: "serpro-1577853" },
			authenticatedDevice: "pixel-7",
		});
		expect(response).toEqual({ status: 200, body: { outcome: "answered", device: "pixel-7" } });
		expect(hub.settlementOf("p-1")?.device).toBe("pixel-7");
	});

	it("never lets a caller name itself — the gate's identity wins", () => {
		const hub = hubWith();
		handlePendingPromptHttp(hub, {
			method: "POST",
			path: "/prompts/p-1/answer",
			body: { value: "x", device: "somebody-else" },
			authenticatedDevice: "pixel-7",
		});
		expect(hub.settlementOf("p-1")?.device).toBe("pixel-7");
	});

	it("records an UNAUTHENTICATED loopback answer as node-local, whatever it claims", () => {
		// The node's loopback listener is ungated by design (a token the node
		// presents to itself defends nothing). Answering from there is acceptable —
		// a local caller could equally walk to the terminal and type — but it must
		// never be able to forge WHO answered.
		for (const claimed of [TERMINAL_PROMPT_DEVICE, "pixel-7", NODE_LOCAL_PROMPT_DEVICE, ""]) {
			const hub = hubWith();
			const response = handlePendingPromptHttp(hub, {
				method: "POST",
				path: "/prompts/p-1/answer",
				body: { value: "x", device: claimed },
				authenticatedDevice: null,
			});
			expect(response.status).toBe(200);
			expect(hub.settlementOf("p-1")?.device).toBe(NODE_LOCAL_PROMPT_DEVICE);
		}
	});

	it("answers a lost race with 409 and who won, not a bare 404", () => {
		const hub = hubWith();
		hub.answer("p-1", "first", "pixel-7");
		const response = handlePendingPromptHttp(hub, {
			method: "POST",
			path: "/prompts/p-1/answer",
			body: { value: "second" },
			authenticatedDevice: "tablet-1",
		});
		expect(response.status).toBe(409);
		expect(response.body).toMatchObject({ error: "already-settled", device: "pixel-7" });
	});

	it("rejects an answer the prompt's constraints refuse, with 400", () => {
		const hub = hubWith({ type: "select", question: "q", options: [{ value: "a", label: "A" }] });
		const response = handlePendingPromptHttp(hub, {
			method: "POST",
			path: "/prompts/p-1/answer",
			body: { value: "z" },
			authenticatedDevice: "pixel-7",
		});
		expect(response.status).toBe(400);
	});

	it("404s an unknown prompt and an unknown path, 405s a wrong method", () => {
		const hub = hubWith();
		expect(
			handlePendingPromptHttp(hub, { method: "POST", path: "/prompts/ghost/answer", body: {} })
				.status,
		).toBe(404);
		expect(handlePendingPromptHttp(hub, { method: "GET", path: "/nope" }).status).toBe(404);
		expect(handlePendingPromptHttp(hub, { method: "POST", path: "/prompts" }).status).toBe(405);
		expect(handlePendingPromptHttp(hub, { method: "GET", path: "/prompts/p-1/answer" }).status).toBe(
			405,
		);
	});

	it("cannot be used to read an answer back — only to give one", () => {
		const hub = hubWith({ type: "secret", question: "VPN password?" });
		const answer = handlePendingPromptHttp(hub, {
			method: "POST",
			path: "/prompts/p-1/answer",
			body: { value: "hunter2-do-not-log" },
			authenticatedDevice: "pixel-7",
		});
		const list = handlePendingPromptHttp(hub, { method: "GET", path: "/prompts" });
		const conflict = handlePendingPromptHttp(hub, {
			method: "POST",
			path: "/prompts/p-1/answer",
			body: { value: "probe" },
			authenticatedDevice: "tablet-1",
		});
		for (const response of [answer, list, conflict]) {
			expect(JSON.stringify(response)).not.toContain("hunter2");
		}
	});
});

describe("a secret answered from a device (P4)", () => {
	it("never appears in anything either side renders, logs, or returns to a peer", async () => {
		const SECRET = "s3nh4-do-cofre-nunca-logar";
		const hub = createPendingPromptHub();
		const written: string[] = [];
		const { input, output } = makeTtyIo();
		output.on("data", (chunk) => written.push(String(chunk)));

		const channel = createPeeredOperatorChannel({
			local: (signal) => createStdioOperatorChannel({ input, output, signal }),
			remote: (signal) => createRemoteOperatorChannel({ hub, asker: ASKER, signal }),
			notify: (message) => written.push(message),
		});
		const pendingAsk = channel.ask({ type: "secret", question: "VPN password?" });
		await tick();

		const published = hub.list()[0]!;
		// The attending device is TOLD the answer will travel, before typing.
		expect(published.answerTravels).toBe(true);
		written.push(JSON.stringify(handlePendingPromptHttp(hub, { method: "GET", path: "/prompts" })));

		written.push(
			JSON.stringify(
				handlePendingPromptHttp(hub, {
					method: "POST",
					path: `/prompts/${published.id}/answer`,
					body: { value: SECRET },
					authenticatedDevice: "pixel-7",
				}),
			),
		);

		// The asker — and only the asker — receives the value.
		await expect(pendingAsk).resolves.toBe(SECRET);
		written.push(JSON.stringify(hub.settlementOf(published.id)));
		expect(written.join("\n")).not.toContain(SECRET);
	});
});

describe("runOperatorChannelConformance — the remote channel is a subject too", () => {
	it("passes for createRemoteOperatorChannel with a device attending", async () => {
		const hub = createPendingPromptHub();
		const abort = new AbortController();
		const off = attend(hub);
		const channel = createRemoteOperatorChannel({ hub, asker: ASKER, signal: abort.signal });
		const result = await runOperatorChannelConformance(channel, {
			triggerCancel: () => abort.abort(),
		});
		off();
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});

	it("passes for createPeeredOperatorChannel, whichever peer answers", async () => {
		const hub = createPendingPromptHub();
		const off = attend(hub, "tablet-1");
		let cancelPeer: (() => void) | null = null;
		const channel = createPeeredOperatorChannel({
			// The terminal is present but silent — every conformance answer arrives
			// from the device, which is exactly the path under test.
			local: (signal) => ({
				ask: ((_prompt: OperatorPrompt) =>
					new Promise<boolean | string>((_resolve, reject) => {
						cancelPeer = () => reject(new OperatorPromptCancelledError());
						signal.addEventListener(
							"abort",
							() => reject(new OperatorPromptCancelledError()),
							{ once: true },
						);
					})) as OperatorChannel["ask"],
			}),
			remote: (signal) => createRemoteOperatorChannel({ hub, asker: ASKER, signal }),
			notify: () => {},
		});
		const result = await runOperatorChannelConformance(channel, {
			triggerCancel: () => cancelPeer?.(),
		});
		off();
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

// ── The ambient prompt publisher ──────────────────────────────────────────────
//
// The seam that closes the last mile without a wizard learning it exists. Two
// properties carry the whole design, and both are asserted here rather than
// assumed: with nothing declared the terminal channel is UNCHANGED, and with
// something declared every channel built afterwards is a peer of it.

describe("setPromptPublisher", () => {
	function hubPublisher(hub: PendingPromptHub): PromptPublisher {
		return {
			remote: (signal) =>
				createRemoteOperatorChannel({ hub, asker: ASKER, signal, timeoutMs: null }),
		};
	}

	it("is OFF by default — nothing is published and nothing is declared", () => {
		expect(currentPromptPublisher()).toBeNull();
	});

	it("with nothing declared, the stdio channel IS the terminal channel", async () => {
		const { input, output } = makeTtyIo();
		const hub = createPendingPromptHub();
		const channel = createStdioOperatorChannel({ input, output });

		const answer = channel.ask({ type: "confirm", question: "proceed?" });
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		// The decisive part: no hub anywhere saw it, because there is no publisher.
		expect(hub.list()).toEqual([]);
	});

	it("with a publisher declared, the SAME call yields a peer of the terminal", async () => {
		const hub = createPendingPromptHub();
		const off = setPromptPublisher(() => hubPublisher(hub));
		try {
			const { input, output } = makeTtyIo();
			const channel = createStdioOperatorChannel({ input, output });
			const answer = channel.ask({ type: "confirm", question: "Bring the VPN up?" });
			await Promise.resolve();
			await Promise.resolve();

			const pending = hub.list();
			expect(pending).toHaveLength(1);
			expect(pending[0]!.prompt.question).toBe("Bring the VPN up?");

			// …and the elsewhere wins the race, with the terminal still untouched.
			expect(hub.answer(pending[0]!.id, true, "my-phone").ok).toBe(true);
			await expect(answer).resolves.toBe(true);
		} finally {
			off();
		}
	});

	it("the terminal still wins when the operator is standing at it", async () => {
		const hub = createPendingPromptHub();
		const off = setPromptPublisher(() => hubPublisher(hub));
		try {
			const { input, output } = makeTtyIo();
			const channel = createStdioOperatorChannel({ input, output });
			const answer = channel.ask({ type: "confirm", question: "proceed?" });
			await Promise.resolve();
			input.write("n\n");
			await expect(answer).resolves.toBe(false);
			// The question is not left hanging on the wire once the terminal settled it.
			expect(hub.list()).toEqual([]);
		} finally {
			off();
		}
	});

	it("a source that throws means the terminal alone, never a broken prompt", async () => {
		const off = setPromptPublisher(() => {
			throw new Error("delivery is misconfigured");
		});
		try {
			expect(currentPromptPublisher()).toBeNull();
			const { input, output } = makeTtyIo();
			const answer = createStdioOperatorChannel({ input, output }).ask({
				type: "confirm",
				question: "proceed?",
			});
			input.write("y\n");
			await expect(answer).resolves.toBe(true);
		} finally {
			off();
		}
	});

	it("a source returning null means the terminal alone", async () => {
		const off = setPromptPublisher(() => null);
		try {
			expect(currentPromptPublisher()).toBeNull();
		} finally {
			off();
		}
		expect(currentPromptPublisher()).toBeNull();
	});

	it("undoing is idempotent and restores what was there before", () => {
		const hub = createPendingPromptHub();
		const offOuter = setPromptPublisher(() => hubPublisher(hub));
		const offInner = setPromptPublisher(() => null);
		expect(currentPromptPublisher()).toBeNull();
		offInner();
		offInner();
		expect(currentPromptPublisher()).not.toBeNull();
		offOuter();
		expect(currentPromptPublisher()).toBeNull();
	});

	it("createTerminalOperatorChannel ignores the publisher entirely", async () => {
		const hub = createPendingPromptHub();
		const off = setPromptPublisher(() => hubPublisher(hub));
		try {
			const { input, output } = makeTtyIo();
			const answer = createTerminalOperatorChannel({ input, output }).ask({
				type: "confirm",
				question: "proceed?",
			});
			input.write("y\n");
			await expect(answer).resolves.toBe(true);
			expect(hub.list()).toEqual([]);
		} finally {
			off();
		}
	});
});

describe("the operator notice shape (D3/D4)", () => {
	const asker = { command: "refarm delivery add", pid: 42, host: "farm" };

	it("normalizes a bare string to a context notice", () => {
		expect(normalizeNoticeInput("o bot é seu")).toEqual({
			message: "o bot é seu",
			kind: "context",
		});
	});

	it("keeps an explicit kind", () => {
		expect(normalizeNoticeInput({ message: "sai desta máquina", kind: "caution" })).toEqual({
			message: "sai desta máquina",
			kind: "caution",
		});
	});

	it("round-trips a stamped notice through the parser", () => {
		const stamped: OperatorNotice = {
			wire: OPERATOR_NOTICE_WIRE,
			ordinal: 7,
			message: "um adaptador registrado: telegram",
			kind: "decision",
			asker,
			at: 1_700_000_000_000,
		};
		expect(parseOperatorNotice(JSON.parse(JSON.stringify(stamped)))).toEqual(stamped);
	});

	it("refuses a notice whose wire is not ours, and one with no message", () => {
		expect(
			parseOperatorNotice({ wire: "other", ordinal: 1, message: "x", kind: "context", asker, at: 1 }),
		).toBeNull();
		expect(
			parseOperatorNotice({
				wire: OPERATOR_NOTICE_WIRE,
				ordinal: 1,
				message: "",
				kind: "context",
				asker,
				at: 1,
			}),
		).toBeNull();
	});

	it("falls back to context for a kind it does not know, rather than dropping the notice", () => {
		const parsed = parseOperatorNotice({
			wire: OPERATOR_NOTICE_WIRE,
			ordinal: 1,
			message: "from a newer node",
			kind: "urgent",
			asker,
			at: 1,
		});
		expect(parsed?.kind).toBe("context");
		expect(parsed?.message).toBe("from a newer node");
	});

	it("drops only the entries that do not parse", () => {
		const list = parseOperatorNoticeList({
			notices: [
				{ wire: OPERATOR_NOTICE_WIRE, ordinal: 1, message: "ok", kind: "context", asker, at: 1 },
				{ wire: "wrong", ordinal: 2, message: "no", kind: "context", asker, at: 2 },
			],
		});
		expect(list).toHaveLength(1);
		expect(list[0]?.message).toBe("ok");
	});
});

describe("say() — the second verb (D1/D8)", () => {
	function capture(): { output: NodeJS.WriteStream; written: () => string } {
		const stream = new PassThrough() as PassThrough & NodeJS.WriteStream;
		let text = "";
		stream.write = ((chunk: string) => {
			text += chunk;
			return true;
		}) as never;
		return { output: stream, written: () => text };
	}

	it("the terminal channel writes the message to its output", () => {
		const { output, written } = capture();
		createTerminalOperatorChannel({ output }).say?.("o bot é seu");
		expect(written()).toContain("o bot é seu");
	});

	it("the scripted channel records instead of printing, so a test can assert on it", () => {
		const channel = createScriptedOperatorChannel(["x"]);
		channel.say?.("primeira");
		channel.say?.({ message: "segunda", kind: "decision" });
		expect(channel.notices()).toEqual([
			{ message: "primeira", kind: "context" },
			{ message: "segunda", kind: "decision" },
		]);
	});

	it("the auto channel does not go mute in CI", () => {
		const { output, written } = capture();
		createAutoOperatorChannel({ output }).say?.("dito em CI");
		expect(written()).toContain("dito em CI");
	});

	it("conformance reports whether a channel announces, without failing the mute ones", async () => {
		// The queue conformance actually consumes: confirm, select, text, secret,
		// cancel — and the first must be a boolean or check 1 fails on its own.
		const scripted = createScriptedOperatorChannel([true, "a", "hello", "secret", "n/a"]);
		const speaking = await runOperatorChannelConformance(scripted, {
			// The sink is what makes exercising `say` safe here — see `captureSay`.
			captureSay: () => scripted.notices(),
		});
		expect(speaking.announces).toBe(true);
		expect(speaking.pass).toBe(true);
		expect(scripted.notices().some((n) => n.message === "_conformance_")).toBe(true);

		// `say` is OPTIONAL (D1), so a channel without it is REPORTED, not failed.
		// Built by stripping `say` off an otherwise identical channel, so the only
		// difference under test is the absence of the verb.
		const { say: _mute, ...withoutSay } = createScriptedOperatorChannel([
			true,
			"a",
			"hello",
			"secret",
			"n/a",
		]);
		const mute = await runOperatorChannelConformance(withoutSay as OperatorChannel);
		expect(mute.announces).toBe(false);
		expect(mute.pass).toBe(true);
	});
});

describe("the hub announces (D5/D9)", () => {
	const asker = { command: "refarm delivery add", pid: 7 };
	const other = { command: "refarm auth enrol", pid: 8 };

	it("stamps a hub-global monotonic ordinal, across askers", () => {
		const hub = createPendingPromptHub();
		const a = hub.announce(asker, "primeira");
		const b = hub.announce(other, "de outro asker");
		const c = hub.announce(asker, "terceira");
		expect([a.ordinal, b.ordinal, c.ordinal]).toEqual([1, 2, 3]);
		expect(a.wire).toBe(OPERATOR_NOTICE_WIRE);
		expect(a.kind).toBe("context");
	});

	it("keeps a bounded ring — notices do not accumulate", () => {
		const hub = createPendingPromptHub({ recentNotices: 3 });
		for (let i = 0; i < 10; i += 1) hub.announce(asker, `n${i}`);
		const kept = hub.notices();
		expect(kept).toHaveLength(3);
		expect(kept.map((n) => n.message)).toEqual(["n7", "n8", "n9"]);
	});

	it("outlives its asker's prompts — the P1 lifetime rule does not transfer", () => {
		const hub = createPendingPromptHub();
		hub.announce(asker, "o enquadramento");
		hub.publish(toPendingPrompt({ type: "text", question: "q" }, { id: "p1", asker }));
		hub.answer("p1", "resposta", "phone");
		expect(hub.notices().map((n) => n.message)).toEqual(["o enquadramento"]);
	});

	it("noticesFor filters by asker, and the cursor belongs to the caller", () => {
		const hub = createPendingPromptHub();
		hub.announce(asker, "uma");
		hub.announce(other, "de outro");
		const third = hub.announce(asker, "duas");

		expect(hub.noticesFor(asker.command).map((n) => n.message)).toEqual(["uma", "duas"]);
		// PURE: asking twice returns the same thing. The hub keeps no watermark.
		expect(hub.noticesFor(asker.command).map((n) => n.message)).toEqual(["uma", "duas"]);

		hub.announce(asker, "três");
		expect(hub.noticesFor(asker.command, third.ordinal).map((n) => n.message)).toEqual(["três"]);
	});

	it("serves two readers with different strategies without either starving", () => {
		const hub = createPendingPromptHub();
		hub.announce(asker, "o enquadramento");

		// A batching reader (the delivery mount, D9) and a polling one hold their
		// own cursors, so neither can consume the other's view.
		const batching = hub.noticesFor(asker.command, 0);
		const polling = hub.noticesFor(asker.command, 0);

		expect(batching.map((n) => n.message)).toEqual(["o enquadramento"]);
		expect(polling.map((n) => n.message)).toEqual(["o enquadramento"]);
	});

	it("announcing does NOT notify the prompt subscribers (D9 — no notice pushes alone)", () => {
		const hub = createPendingPromptHub();
		const seen: string[] = [];
		hub.subscribe((pending) => seen.push(pending.id));
		hub.announce(asker, "isto não deve empurrar nada");
		expect(seen).toEqual([]);
		hub.publish(toPendingPrompt({ type: "text", question: "q" }, { id: "p9", asker }));
		expect(seen).toEqual(["p9"]);
	});
});

describe("say() reaches the elsewhere (D7)", () => {
	const asker = { command: "refarm delivery add" };

	it("the remote channel announces into the hub", () => {
		const hub = createPendingPromptHub();
		createRemoteOperatorChannel({ hub, asker }).say?.({
			message: "o bot é seu",
			kind: "context",
		});
		expect(hub.notices().map((n) => n.message)).toEqual(["o bot é seu"]);
	});

	it("the peered channel says it at the terminal AND publishes it", () => {
		const hub = createPendingPromptHub();
		const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
		let written = "";
		output.write = ((chunk: string) => {
			written += chunk;
			return true;
		}) as never;

		createPeeredOperatorChannel({
			local: () => createTerminalOperatorChannel({ output }),
			remote: () => createRemoteOperatorChannel({ hub, asker }),
			announce: (notice) => void hub.announce(asker, notice),
		}).say?.("dito nos dois lados");

		expect(written).toContain("dito nos dois lados");
		expect(hub.notices().map((n) => n.message)).toEqual(["dito nos dois lados"]);
	});

	it("a publisher that throws does not stop the terminal from saying it", () => {
		const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
		let written = "";
		output.write = ((chunk: string) => {
			written += chunk;
			return true;
		}) as never;

		// `say` is TOTAL: a broken notification arrangement must not become the
		// wizard's problem.
		expect(() =>
			createPeeredOperatorChannel({
				local: () => createTerminalOperatorChannel({ output }),
				remote: () => createRemoteOperatorChannel({ hub: createPendingPromptHub(), asker }),
				announce: () => {
					throw new Error("transport down");
				},
			}).say?.("ainda assim aparece aqui"),
		).not.toThrow();
		expect(written).toContain("ainda assim aparece aqui");
	});
});

describe("conformance does not pollute its host's output", () => {
	it("never calls say() when the caller cannot see where it lands", async () => {
		// The hardening collector runs this against real channels, and the auto
		// channel writes to stdout — so an unconditional `say` printed
		// `_conformance_` into the collector's own report. A suite that dirties its
		// host's output to prove a property has made that output less trustworthy.
		const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
		let written = "";
		output.write = ((chunk: string) => {
			written += chunk;
			return true;
		}) as never;

		const result = await runOperatorChannelConformance(createAutoOperatorChannel({ output }));

		expect(result.announces).toBe(true); // still REPORTED…
		expect(written).toBe(""); // …and never exercised.
	});
});

describe("createAttendedOperatorChannel — the phone, with no terminal behind it", () => {
	// Its OWN publisher, deliberately not the one in the describe above. Reaching across that
	// scope threw a ReferenceError inside the publisher THUNK, where `currentPromptPublisher`'s
	// catch swallowed it and returned null — so the first run of these tests failed with "no
	// publisher declared" for a publisher that was declared. A catch that turns a programming
	// error into a legitimate-looking absence is the exact shape this suite keeps guarding against.
	const ATTENDED_ASKER = { command: "test", host: "test-host", pid: 1 };
	function publisherFor(hub: PendingPromptHub): PromptPublisher {
		return {
			remote: (signal) =>
				createRemoteOperatorChannel({ hub, asker: ATTENDED_ASKER, signal, timeoutMs: null }),
		};
	}

	/**
	 * ISS-116. `refarm process install` refused whenever stdin was not a TTY, so an operator away
	 * from this machine could DECLARE a process and could not install it. The refusal was right —
	 * a consent prompt with nobody behind it is not answered yes and not answered no — but the
	 * node has published questions to enrolled devices since the pending-prompt bridge, and that
	 * path was simply never reached.
	 */
	it("reaches the hub with no terminal involved at all", async () => {
		const hub = createPendingPromptHub();
		const off = setPromptPublisher(() => publisherFor(hub));
		try {
			const channel = createAttendedOperatorChannel();
			expect(channel).not.toBeNull();
			const answer = channel!.ask({ type: "confirm", question: "Install refarm-automations?" });
			await Promise.resolve();
			await Promise.resolve();

			const pending = hub.list();
			expect(pending).toHaveLength(1);
			expect(hub.answer(pending[0]!.id, true, "my-phone").ok).toBe(true);
			await expect(answer).resolves.toBe(true);
		} finally {
			off();
		}
	});

	it("is NOT a peered channel, which is the whole reason it exists", async () => {
		// The trap this avoids: `readline` settles a non-TTY stdin immediately — a closed or piped
		// input fires `close`, which becomes OperatorPromptCancelledError. A peered channel would
		// therefore REJECT LOCALLY FIRST, win its own race, and withdraw the question from the
		// operator's phone before anyone could see it. A dead peer is worse than no peer: it
		// reports "cancelled" for a question that was never shown.
		//
		// Proven by leaving the question outstanding for longer than any local settle would take.
		const hub = createPendingPromptHub();
		const off = setPromptPublisher(() => publisherFor(hub));
		try {
			const channel = createAttendedOperatorChannel();
			const answer = channel!.ask({ type: "confirm", question: "still waiting?" });
			for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
			expect(hub.list()).toHaveLength(1);

			hub.answer(hub.list()[0]!.id, false, "my-phone");
			await expect(answer).resolves.toBe(false);
		} finally {
			off();
		}
	});

	it("returns NULL when nothing publishes — a claim about a human is not a wire", () => {
		// `--attended-elsewhere` says a person is watching. With no publisher there is nowhere for
		// the question to go, and the caller must treat that as "no operator" rather than invent a
		// default. Silence here is the same silence a missing terminal is.
		expect(createAttendedOperatorChannel()).toBeNull();
	});
});

describe("createOperatorChannelFor — the channel must match how the operator is present", () => {
	/**
	 * Measured 2026-08-11, across FIVE commands that offer `--attended-elsewhere`: each gated its
	 * refusal on `atTerminal || attendedElsewhere` and then built the peered channel regardless of
	 * which one was true. With stdin at /dev/null the terminal half settled instantly, WON the
	 * race, and the question was withdrawn from every attending device before it could be shown —
	 * so the flag did the opposite of what its own help text promised, everywhere it was offered.
	 * It appeared to work only when something was actively writing to stdin (a remote pty), which
	 * is the one case it was not needed for.
	 */
	const ASKER_2 = { command: "test", host: "test-host", pid: 2 };
	function publisherFor2(hub: PendingPromptHub): PromptPublisher {
		return {
			remote: (signal) =>
				createRemoteOperatorChannel({ hub, asker: ASKER_2, signal, timeoutMs: null }),
		};
	}

	it("attended elsewhere with NO terminal reaches the hub and stays there", async () => {
		const hub = createPendingPromptHub();
		const off = setPromptPublisher(() => publisherFor2(hub));
		try {
			const channel = createOperatorChannelFor({ atTerminal: false, attendedElsewhere: true });
			expect(channel).not.toBeNull();
			const answer = channel!.ask({ type: "confirm", question: "Bring the VPN up?" });
			for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
			// The assertion that would have failed before: a peered channel leaves ZERO here,
			// because its dead local half already cancelled the question.
			expect(hub.list()).toHaveLength(1);
			hub.answer(hub.list()[0]!.id, true, "my-phone");
			await expect(answer).resolves.toBe(true);
		} finally {
			off();
		}
	});

	it("at a terminal it is still the PEERED channel — the phone is a peer, not a replacement", async () => {
		const hub = createPendingPromptHub();
		const off = setPromptPublisher(() => publisherFor2(hub));
		try {
			const { input, output } = makeTtyIo();
			const channel = createOperatorChannelFor({ atTerminal: true }, { input, output });
			const answer = channel!.ask({ type: "confirm", question: "proceed?" });
			await Promise.resolve();
			// Published to the devices AND answerable at the terminal.
			expect(hub.list()).toHaveLength(1);
			input.write("y\n");
			await expect(answer).resolves.toBe(true);
			expect(hub.list()).toEqual([]);
		} finally {
			off();
		}
	});

	it("is NULL when neither — nobody to ask is a verdict, not a default", () => {
		expect(createOperatorChannelFor({ atTerminal: false })).toBeNull();
		expect(createOperatorChannelFor({ atTerminal: false, attendedElsewhere: false })).toBeNull();
	});

	it("is NULL when attendance is CLAIMED and nothing publishes", () => {
		// A caller must refuse on this rather than fall back to a channel that answers for the
		// operator. Falling back to an auto-answering channel would approve the very operation the
		// guard exists to gate — and that is not hypothetical: it was written, and caught, in the
		// same slice that added this function.
		expect(createOperatorChannelFor({ atTerminal: false, attendedElsewhere: true })).toBeNull();
	});
});

/**
 * ISS-135 — THE SELECT FRAME AND THE WIDTH IT WAS PAINTED AT.
 *
 * The redraw erases the previous frame by climbing a row count measured when that frame was
 * written. While the width holds, the measurement and the screen agree; change the width in between
 * and the count describes a screen that no longer exists. Both directions fail, and only one of
 * them leaves evidence:
 *
 *     narrowed 120 -> 80    the climb rises short   -> the top of the old frame survives (GHOST)
 *     widened   80 -> 120   the climb rises far     -> rows ABOVE the frame are erased (SILENT)
 *
 * These tests drive the real prompt against a fake TTY, capture every byte, and replay the stream
 * through a terminal small enough to trust. The assertion is about the SCREEN, which is the only
 * thing the operator ever sees — not about which escape codes were emitted.
 */
describe("askSelect redraw survives a width change", () => {
	/** Auto-wrap, LF as CRLF, and the cursor/erase codes `readline` emits. Nothing else. */
	function screenOf(bytes: string, columns: number): string[] {
		const rows: string[][] = [];
		let row = 0;
		let col = 0;
		const at = (r: number) => (rows[r] ??= []);
		for (let i = 0; i < bytes.length; i += 1) {
			const ch = bytes[i]!;
			if (ch === "\x1b" && bytes[i + 1] === "[") {
				let j = i + 2;
				while (j < bytes.length && /[0-9;]/u.test(bytes[j]!)) j += 1;
				const params = bytes.slice(i + 2, j);
				const final = bytes[j];
				const parts = params.split(";").map((p) => (p === "" ? undefined : Number.parseInt(p, 10)));
				const n = parts[0];
				if (final === "A") row = Math.max(0, row - (n ?? 1));
				else if (final === "B") row += n ?? 1;
				else if (final === "G") col = (n ?? 1) - 1;
				else if (final === "H") {
					row = (n ?? 1) - 1;
					col = (parts[1] ?? 1) - 1;
				} else if (final === "J" && (n ?? 0) === 0) {
					at(row).length = col;
					rows.length = row + 1;
				} else if (final === "K" && (n ?? 0) === 0) at(row).length = col;
				i = j;
				continue;
			}
			if (ch === "\n") {
				row += 1;
				col = 0;
				continue;
			}
			if (ch === "\r") {
				col = 0;
				continue;
			}
			if (col >= columns) {
				col = 0;
				row += 1;
			}
			at(row)[col] = ch;
			col += 1;
		}
		return rows.map((r) => (r ?? []).map((c) => c ?? " ").join("").trimEnd());
	}

	const OPTIONS = [
		"Subscription - OpenAI Codex (ChatGPT sign-in)",
		"Subscription - Anthropic Claude (Pro/Max)",
		"Subscription - GitHub Copilot",
		"API key - OpenAI API key",
		"API key - Gemini (Google)",
		"Local - Ollama  (no key required)",
	].map((label, i) => ({
		value: `v${i}`,
		label,
		description: "Use a logged-in provider account when supported.",
	}));

	const HEADER = "  Model Provider — a line the prompt does not own";

	/** Paints the frame, applies `finalColumns`, presses a key, then answers. */
	async function paintAcross(startColumns: number, finalColumns: number) {
		const captured: string[] = [];
		const output = {
			isTTY: true,
			columns: startColumns,
			rows: 60,
			write(chunk: string) {
				captured.push(String(chunk));
				return true;
			},
		} as unknown as NodeJS.WriteStream;
		const input = new PassThrough() as unknown as NodeJS.ReadStream;
		(input as unknown as { isTTY: boolean }).isTTY = true;
		(input as unknown as { isRaw: boolean }).isRaw = false;
		(input as unknown as { setRawMode: (v: boolean) => void }).setRawMode = (v) => {
			(input as unknown as { isRaw: boolean }).isRaw = v;
		};

		const channel = createStdioOperatorChannel({ input, output, transition: "preserve" });
		output.write(`${HEADER}\n`);
		const answer = channel.ask({
			type: "select",
			question: "Select provider:",
			default: "v0",
			options: OPTIONS,
		});
		const settle = () => new Promise((r) => setImmediate(r));
		await settle();
		(output as unknown as { columns: number }).columns = finalColumns;
		input.write("\x1b[B");
		await settle();
		input.write("\r");
		await answer;

		return screenOf(captured.join(""), finalColumns);
	}

	const framesOn = (screen: string[]) =>
		screen.filter((line) => line.includes("Select provider:")).length;

	it("leaves ONE frame when the terminal narrows under it", async () => {
		const screen = await paintAcross(120, 80);
		expect(framesOn(screen)).toBe(1);
	});

	it("leaves ONE frame when the terminal widens under it", async () => {
		const screen = await paintAcross(80, 120);
		expect(framesOn(screen)).toBe(1);
	});

	it("erases only its own rows while the width holds", async () => {
		// The silent direction. A redraw that rises too far takes rows it never wrote, and nothing
		// about the result says so — which is why this asserts on a line the prompt does not own.
		const screen = await paintAcross(100, 100);
		expect(framesOn(screen)).toBe(1);
		expect(screen.some((line) => line.includes("Model Provider"))).toBe(true);
	});
});

/**
 * ISS-135, second half — the frame must FIT, or no erase can be right.
 *
 * The first half recorded the width the frame was painted at. This one is a different failure that
 * looks identical on screen: a frame taller than the viewport SCROLLS as it is written, and what
 * scrolls off the top is in SCROLLBACK, where `clearScreenDown` — which clears the VISIBLE screen —
 * can never reach it. Measured 2026-08-17 against the real prompt through a terminal that models
 * scrollback:
 *
 *     viewport 16 rows   frame fits      one frame on screen
 *     viewport 12 rows   frame scrolls   the question line appears THREE times
 *
 * The redraw was correct throughout. Only making the frame fit removes the class.
 */
describe("the select frame fits the screen", () => {
	it("shows everything when the screen can hold it", () => {
		expect(optionCapacityFor(60, 13)).toBeUndefined();
		expect(visibleOptionWindow(13, 0, undefined)).toEqual({ start: 0, end: 13 });
	});

	it("shows everything when the stream reports no height, because there is nothing to overflow", () => {
		expect(optionCapacityFor(undefined, 13)).toBeUndefined();
	});

	it("reserves rows for the question, the hint and the indicators", () => {
		// A budget that forgot them produces a frame one row too tall, which IS the failure —
		// arrived at from the other direction.
		expect(optionCapacityFor(12, 13)).toBe(7); // 12 - (question+hint+spare) - two indicators
	});

	it("never yields an empty picker on a very short screen", () => {
		expect(optionCapacityFor(4, 13)).toBe(1);
		expect(visibleOptionWindow(13, 6, 1)).toEqual({ start: 6, end: 7 });
	});

	it("centres the window on the selection", () => {
		expect(visibleOptionWindow(13, 6, 5)).toEqual({ start: 4, end: 9 });
	});

	it("keeps the window FULL at both ends rather than half-empty", () => {
		// Clamping after centring is what does this; clamping the centre first would show three
		// options at the top of a list and three at the bottom while the screen had room for five.
		expect(visibleOptionWindow(13, 0, 5)).toEqual({ start: 0, end: 5 });
		expect(visibleOptionWindow(13, 12, 5)).toEqual({ start: 8, end: 13 });
	});

	it("keeps the selection inside the window at every position", () => {
		for (let selected = 0; selected < 13; selected += 1) {
			const { start, end } = visibleOptionWindow(13, selected, 5);
			expect(selected).toBeGreaterThanOrEqual(start);
			expect(selected).toBeLessThan(end);
		}
	});
});

/**
 * MEASURED ON A REAL TERMINAL, 2026-08-19:
 *
 *   Qual processo? (refarm já sabe propor: web-serve) (web-serve) [web-serve]:
 *
 * The same value three times — once in the caller's prose, once as the placeholder, once as the
 * default. A line that says one thing three ways reads as three things, and the operator has to
 * work out that they are the same before answering.
 */
describe("textPromptHint", () => {
	it("prints a value ONCE when the placeholder and the default agree", () => {
		expect(textPromptHint({ type: "text", question: "q", placeholder: "web-serve", default: "web-serve" })).toBe(
			" [web-serve]",
		);
	});

	it("keeps both when they say DIFFERENT things", () => {
		// A placeholder that shows the SHAPE of an answer and a default that is one are two facts,
		// and collapsing them would lose the example.
		expect(
			textPromptHint({ type: "text", question: "q", placeholder: "/usr/bin/node app.js", default: "web-serve" }),
		).toBe(" (/usr/bin/node app.js) [web-serve]");
	});

	it("renders each alone when only one is given", () => {
		expect(textPromptHint({ type: "text", question: "q", placeholder: "meu-servico" })).toBe(" (meu-servico)");
		expect(textPromptHint({ type: "text", question: "q", default: "web-serve" })).toBe(" [web-serve]");
		expect(textPromptHint({ type: "text", question: "q" })).toBe("");
	});
});
