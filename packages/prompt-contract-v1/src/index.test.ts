import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	createAutoOperatorChannel,
	createScriptedOperatorChannel,
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
	PROMPT_CAPABILITY,
	runOperatorChannelConformance,
	type OperatorChannel,
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
