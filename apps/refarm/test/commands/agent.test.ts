import { describe, expect, it, vi } from "vitest";
import { createAgentCommand } from "../../src/commands/agent.js";

describe("agent command", () => {
	it("documents runtime, credential, model, and plugin handoffs in help", () => {
		const agentCommand = createAgentCommand();
		let help = "";
		agentCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		agentCommand.outputHelp();

		expect(help).toContain("refarm runtime status");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm doctor --next-command");
		expect(help).toContain("refarm check --next-action --json");
		expect(help).toContain("refarm check --next-command");
		expect(help).toContain("refarm tidy imports --check");
		expect(help).toContain("refarm tidy imports");
		expect(help).toContain("refarm agent finish --json");
		expect(help).toContain("refarm sow");
		expect(help).toContain("refarm model current");
		expect(help).toContain("refarm model openai/gpt-5.5");
		expect(help).toContain("refarm model base-url");
		expect(help).toContain("refarm model fallback");
		expect(help).toContain("refarm plugin install");
		expect(help).toContain("refarm agent --json");
	});

	it("prints help when invoked without subcommands", async () => {
		const agentCommand = createAgentCommand();
		let output = "";
		agentCommand.configureOutput({
			writeOut: (value) => {
				output += value;
			},
		});

		await agentCommand.parseAsync([], { from: "user" });

		expect(output).toContain("refarm runtime status");
		expect(output).toContain("refarm doctor --next-action");
		expect(output).toContain("refarm doctor --next-command");
		expect(output).toContain("refarm check --next-action --json");
		expect(output).toContain("refarm check --next-command");
		expect(output).toContain("refarm tidy imports --check");
		expect(output).toContain("refarm tidy imports");
		expect(output).toContain("refarm sow");
		expect(output).toContain("refarm model current");
		expect(output).toContain("refarm model base-url");
	});

	it("prints a machine-readable agent handoff plan", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			runtime: { status: string; doctorCommand: string };
			usage: { tidyCheck: string; tidyApply: string };
			credentials: { status: string };
			plugins: { install: string };
			verification: {
				quick: string;
				quickCommand: string;
				tidyCheck: string;
			};
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "handoff",
			runtime: {
				status: "refarm runtime status --json",
				doctorCommand: "refarm doctor --next-command",
			},
			usage: {
				tidyCheck: "refarm tidy imports --check --json",
				tidyApply: "refarm tidy imports --json",
			},
			credentials: { status: "refarm model current --json" },
			plugins: { install: "refarm plugin install --json" },
			verification: {
				quick: "refarm check --next-action --json",
				quickCommand: "refarm check --next-command",
				tidyCheck: "refarm tidy imports --check --json",
			},
			nextAction: "refarm check --next-action --json",
			nextCommand: "refarm check --next-command",
		});
		expect(payload.nextActions).toContain("refarm runtime status --json");
		expect(payload.nextCommands).toEqual(["refarm check --next-command"]);
		logSpy.mockRestore();
	});

	it("prints an end-of-slice verification plan", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			steps: { id: string; command: string; description: string }[];
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "plan",
			nextCommand: "refarm tidy imports --check --json",
			nextCommands: [
				"refarm tidy imports --check --json",
				"refarm health --next-action --json",
				"refarm check --next-action --json",
			],
		});
		expect(payload.nextActions).toEqual(payload.nextCommands);
		expect(payload.steps).toEqual([
			expect.objectContaining({
				id: "tidy-imports-check",
				command: "refarm tidy imports --check --json",
			}),
			expect.objectContaining({
				id: "health",
				command: "refarm health --next-action --json",
			}),
			expect.objectContaining({
				id: "check",
				command: "refarm check --next-action --json",
			}),
		]);
		logSpy.mockRestore();
	});
});
