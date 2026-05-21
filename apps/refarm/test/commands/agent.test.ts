import { describe, expect, it } from "vitest";
import { agentCommand } from "../../src/commands/agent.js";

describe("agent command", () => {
	it("documents runtime, credential, model, and plugin handoffs", () => {
		let help = "";
		agentCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		agentCommand.outputHelp();

		expect(help).toContain("refarm runtime");
		expect(help).toContain("refarm sow");
		expect(help).toContain("refarm model current");
		expect(help).toContain("refarm plugin install");
	});
});
