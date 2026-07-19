import { describe, expect, it } from "vitest";

import { runInteractiveForm } from "./tui-form.js";
import { scriptedInput } from "./tui-input.js";

const char = (c: string) => ({ name: c, sequence: c });

describe("runInteractiveForm (headless)", () => {
	it("collects typed values across fields (Tab moves) and submits on Enter", async () => {
		const result = await runInteractiveForm({
			fields: [{ name: "query", required: true }, { name: "limit" }],
			input: scriptedInput([
				char("a"),
				char("b"),
				char("c"),
				{ name: "tab" }, // move to limit
				char("5"),
				{ name: "return" },
			]),
			output: () => {},
		});
		expect(result).toEqual({ query: "abc", limit: "5" });
	});

	it("blocks submit while a required field is empty, then cancels on Esc", async () => {
		const result = await runInteractiveForm({
			fields: [{ name: "query", required: true }],
			input: scriptedInput([{ name: "return" }, { name: "escape" }]), // Enter blocked (empty), then Esc
			output: () => {},
		});
		expect(result).toBeNull();
	});

	it("backspace deletes from the focused field", async () => {
		const result = await runInteractiveForm({
			fields: [{ name: "q" }],
			input: scriptedInput([char("a"), char("b"), { name: "backspace" }, { name: "return" }]),
			output: () => {},
		});
		expect(result).toEqual({ q: "a" });
	});

	it("submits immediately when an optional field is left blank", async () => {
		const result = await runInteractiveForm({
			fields: [{ name: "note" }],
			input: scriptedInput([{ name: "return" }]),
			output: () => {},
		});
		expect(result).toEqual({ note: "" });
	});

	it("Esc cancels and returns null", async () => {
		const result = await runInteractiveForm({
			fields: [{ name: "q" }],
			input: scriptedInput([{ name: "escape" }]),
			output: () => {},
		});
		expect(result).toBeNull();
	});

	it("space is a printable character (via the `space` key name)", async () => {
		const result = await runInteractiveForm({
			fields: [{ name: "q" }],
			input: scriptedInput([char("a"), { name: "space", sequence: " " }, char("b"), { name: "return" }]),
			output: () => {},
		});
		expect(result).toEqual({ q: "a b" });
	});

	it("toggles a boolean field with space and returns true/false", async () => {
		const on = await runInteractiveForm({
			fields: [{ name: "verbose", kind: "boolean" }],
			input: scriptedInput([{ name: "space" }, { name: "return" }]),
			output: () => {},
		});
		expect(on).toEqual({ verbose: "true" });
		const off = await runInteractiveForm({
			fields: [{ name: "verbose", kind: "boolean" }],
			input: scriptedInput([{ name: "return" }]), // untouched → false
			output: () => {},
		});
		expect(off).toEqual({ verbose: "false" });
	});

	it("cycles an enum field with the arrow keys, including back to unset", async () => {
		const chosen = await runInteractiveForm({
			fields: [{ name: "mode", kind: "enum", options: ["fast", "slow"] }],
			input: scriptedInput([{ name: "right" }, { name: "return" }]), // "" → "fast"
			output: () => {},
		});
		expect(chosen).toEqual({ mode: "fast" });
		const unset = await runInteractiveForm({
			fields: [{ name: "mode", kind: "enum", options: ["fast", "slow"] }],
			input: scriptedInput([{ name: "right" }, { name: "left" }, { name: "return" }]), // ""→fast→""
			output: () => {},
		});
		expect(unset).toEqual({ mode: "" });
	});
});
