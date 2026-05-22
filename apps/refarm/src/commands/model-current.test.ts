import { afterEach, describe, expect, it, vi } from "vitest";
import { printCurrentModel } from "./model.js";

function captureCurrentModel(tokens = {}): string {
	const lines: string[] = [];
	const log = vi.spyOn(console, "log").mockImplementation((line = "") => {
		lines.push(String(line));
	});
	try {
		printCurrentModel(tokens);
		return lines.join("\n");
	} finally {
		log.mockRestore();
	}
}

describe("printCurrentModel", () => {
	afterEach(() => {
		delete process.env.MODEL_PROVIDER;
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.MODEL_ID;
		delete process.env.OPENAI_API_KEY;
	});

	it("shows the effective default route even when credentials are missing", () => {
		const output = captureCurrentModel();

		expect(output).toContain("current: openai/gpt-5.5");
		expect(output).toContain("provider: openai");
		expect(output).toContain("key env:  OPENAI_API_KEY");
		expect(output).toContain("key:      missing (run refarm sow)");
		expect(output).toContain("source:   built-in defaults");
		expect(output).toContain("login:          refarm sow");
	});

	it("marks environment overrides as the active source", () => {
		process.env.MODEL_PROVIDER = "gemini";

		const output = captureCurrentModel();

		expect(output).toContain("current: gemini/gemini-3-flash-preview");
		expect(output).toContain("key env:  GEMINI_API_KEY");
		expect(output).toContain("source:   environment overrides are active");
	});
});
