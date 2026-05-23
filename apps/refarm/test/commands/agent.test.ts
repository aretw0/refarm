import { describe, expect, it } from "vitest";
import { agentCommand } from "../../src/commands/agent.js";

describe("agent command", () => {
	it("documents runtime, credential, model, and plugin handoffs in help", () => {
		let help = "";
		agentCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		agentCommand.outputHelp();

		expect(help).toContain("refarm runtime status");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm tidy imports --check");
		expect(help).toContain("refarm sow");
		expect(help).toContain("refarm model current");
		expect(help).toContain("refarm model openai/gpt-5.5");
		expect(help).toContain("refarm model base-url");
		expect(help).toContain("refarm model fallback");
		expect(help).toContain("refarm plugin install");
	});

	it("prints help when invoked without subcommands", async () => {
		let output = "";
		agentCommand.configureOutput({
			writeOut: (value) => {
				output += value;
			},
		});

		await agentCommand.parseAsync([], { from: "user" });

		expect(output).toContain("refarm runtime status");
		expect(output).toContain("refarm doctor --next-action");
		expect(output).toContain("refarm tidy imports --check");
		expect(output).toContain("refarm sow");
		expect(output).toContain("refarm model current");
		expect(output).toContain("refarm model base-url");
	});
});
