import { describe, expect, it, vi } from "vitest";
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
		expect(help).toContain("refarm tidy imports");
		expect(help).toContain("refarm sow");
		expect(help).toContain("refarm model current");
		expect(help).toContain("refarm model openai/gpt-5.5");
		expect(help).toContain("refarm model base-url");
		expect(help).toContain("refarm model fallback");
		expect(help).toContain("refarm plugin install");
		expect(help).toContain("refarm agent --json");
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
		expect(output).toContain("refarm tidy imports");
		expect(output).toContain("refarm sow");
		expect(output).toContain("refarm model current");
		expect(output).toContain("refarm model base-url");
	});

	it("prints a machine-readable agent handoff plan", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			runtime: { status: string };
			usage: { tidyCheck: string; tidyApply: string };
			credentials: { status: string };
			plugins: { install: string };
			nextActions: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "handoff",
			runtime: { status: "refarm runtime status --json" },
			usage: {
				tidyCheck: "refarm tidy imports --check --json",
				tidyApply: "refarm tidy imports --json",
			},
			credentials: { status: "refarm model current --json" },
			plugins: { install: "refarm plugin install --json" },
		});
		expect(payload.nextActions).toContain("refarm doctor --next-action --json");
		logSpy.mockRestore();
	});
});
