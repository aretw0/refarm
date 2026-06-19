import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	PROMPT_CAPABILITY,
	createAutoOperatorChannel,
	createScriptedOperatorChannel,
	createStdioOperatorChannel,
	runOperatorChannelConformance,
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
		return input;
	};
	input.pause = () => {
		paused = true;
		pauseCalls += 1;
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
		const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
		expect(
			await ch.ask({ type: "select", question: "pick", options: opts, default: "b" }),
		).toBe("b");
	});

	it("returns first option when no default on select", async () => {
		const ch = createAutoOperatorChannel();
		const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
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
		const opts = [{ value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" }];
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
});

describe("runOperatorChannelConformance", () => {
	it("passes for createAutoOperatorChannel", async () => {
		const result = await runOperatorChannelConformance(createAutoOperatorChannel());
		expect(result.pass).toBe(true);
		expect(result.total).toBeGreaterThanOrEqual(3);
		expect(result.failures).toEqual([]);
	});

	it("passes for createScriptedOperatorChannel with matching answers", async () => {
		// Conformance asks: confirm(default:true), select(default:"a"), text(default:"hello"), secret
		// Auto channel handles all of these — use it to verify the scripted channel works too
		const ch = createScriptedOperatorChannel([true, "a", "hello", "secret"]);
		const result = await runOperatorChannelConformance(ch);
		expect(result.pass).toBe(true);
	});
});
