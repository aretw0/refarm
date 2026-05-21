import { describe, expect, it } from "vitest";
import { createChatCommand } from "../../src/commands/chat.js";

describe("chat command help", () => {
	it("documents runtime commands available inside the REPL", () => {
		const command = createChatCommand();
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("/model openai/gpt-5.5");
		expect(help).toContain("/model worker openai/gpt-5.3-codex-spark");
		expect(help).toContain("/model fallback ollama/llama3.2");
		expect(help).toContain("/login");
		expect(help).toContain("Refarm runtime");
	});
});
