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
		expect(help).toContain("refarm agent finish --next-command");
		expect(help).toContain("refarm agent finish --fix --run");
		expect(help).toContain("refarm agent finish --run");
		expect(help).toContain("refarm agent finish --run --json");
		expect(help).toContain("refarm agent finish --run --next-command");
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
			runtime: { status: string; start: string; doctorCommand: string };
			usage: { tidyCheck: string; tidyApply: string };
			credentials: { status: string };
			plugins: { install: string };
			verification: {
				quick: string;
				quickCommand: string;
				tidyCheck: string;
				finishPlanCommand: string;
				finishRunCommand: string;
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
				start: "refarm runtime start --wait --json",
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
				finishPlanCommand: "refarm agent finish --next-command",
				finishRunCommand: "refarm agent finish --run --next-command",
			},
			nextAction: "refarm check --next-action --json",
			nextCommand: "refarm check --next-command",
		});
		expect(payload.nextActions).toContain("refarm runtime status --json");
		expect(payload.nextActions).toContain("refarm agent finish --next-command");
		expect(payload.nextCommands).toEqual([
			"refarm check --next-command",
			"refarm agent finish --next-command",
		]);
		logSpy.mockRestore();
	});

	it("prints an end-of-slice verification plan", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			steps: {
				id: string;
				command: string;
				args: string[];
				description: string;
			}[];
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
				args: ["tidy", "imports", "--check", "--json"],
			}),
			expect.objectContaining({
				id: "health",
				command: "refarm health --next-action --json",
				args: ["health", "--next-action", "--json"],
			}),
			expect.objectContaining({
				id: "check",
				command: "refarm check --next-action --json",
				args: ["check", "--next-action", "--json"],
			}),
		]);
		logSpy.mockRestore();
	});

	it("prints the next finish command without JSON parsing", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--next-command"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith("refarm tidy imports --check --json");
		logSpy.mockRestore();
	});

	it("prints the next fix finish command without executing it", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--fix", "--next-command"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith("refarm tidy imports --json");
		logSpy.mockRestore();
	});

	it("runs the finish plan and reports passing steps", async () => {
		const runRefarm = vi.fn((args: string[]) => ({
			id: args.join(" "),
			command: `refarm ${args.join(" ")}`,
			args,
			description: "test step",
			ok: true,
			exitCode: 0,
			stdout: JSON.stringify({ ok: true }),
			stderr: "",
			payload: { ok: true },
		}));
		const agentCommand = createAgentCommand({ runRefarm });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--run", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			steps: { ok: boolean; args: string[] }[];
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "passed",
			nextCommands: [],
		});
		expect(payload.steps).toHaveLength(3);
		expect(payload.steps[0]).toMatchObject({
			id: "tidy-imports-check",
			ok: true,
		});
		expect(payload.steps[0]?.args).toEqual([
			"tidy",
			"imports",
			"--check",
			"--json",
		]);
		expect(runRefarm).toHaveBeenCalledTimes(3);
		logSpy.mockRestore();
	});

	it("runs import organization before finish checks when --fix is set", async () => {
		const runRefarm = vi.fn((args: string[]) => ({
			id: args.join(" "),
			command: `refarm ${args.join(" ")}`,
			args,
			description: "test step",
			ok: true,
			exitCode: 0,
			stdout: JSON.stringify({ ok: true }),
			stderr: "",
			payload: { ok: true },
		}));
		const agentCommand = createAgentCommand({ runRefarm });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--fix", "--run", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			steps: { id: string; args: string[] }[];
		};
		expect(payload.ok).toBe(true);
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports",
			"tidy-imports-check",
			"health",
			"check",
		]);
		expect(payload.steps[0]?.args).toEqual(["tidy", "imports", "--json"]);
		expect(runRefarm).toHaveBeenCalledTimes(4);
		logSpy.mockRestore();
	});

	it("stops finish runs at the first failing step and forwards recovery commands", async () => {
		const runRefarm = vi
			.fn()
			.mockImplementationOnce((args: string[]) => ({
				id: args.join(" "),
				command: `refarm ${args.join(" ")}`,
				args,
				description: "test step",
				ok: true,
				exitCode: 0,
				stdout: JSON.stringify({ ok: true }),
				stderr: "",
				payload: { ok: true },
			}))
			.mockImplementationOnce((args: string[]) => ({
				id: args.join(" "),
				command: `refarm ${args.join(" ")}`,
				args,
				description: "test step",
				ok: false,
				exitCode: 1,
				stdout: JSON.stringify({
					ok: false,
					nextActions: ["Start the runtime before running the full check."],
					nextCommands: ["refarm runtime start --wait"],
				}),
				stderr: "",
				payload: {
					ok: false,
					nextActions: ["Start the runtime before running the full check."],
					nextCommands: ["refarm runtime start --wait"],
				},
			}));
		const agentCommand = createAgentCommand({ runRefarm });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		await agentCommand.parseAsync(["finish", "--run", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			steps: { id: string; ok: boolean }[];
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			status: "failed",
			nextAction: "Start the runtime before running the full check.",
			nextActions: ["Start the runtime before running the full check."],
			nextCommand: "refarm runtime start --wait",
			nextCommands: ["refarm runtime start --wait"],
		});
		expect(payload.steps).toHaveLength(2);
		expect(payload.steps[1]).toMatchObject({
			id: "health",
			ok: false,
		});
		expect(runRefarm).toHaveBeenCalledTimes(2);
		expect(process.exitCode).toBe(1);
		process.exitCode = originalExitCode;
		logSpy.mockRestore();
	});

	it("prints the next recovery command for failing finish runs", async () => {
		const runRefarm = vi.fn((args: string[]) => ({
			id: args.join(" "),
			command: `refarm ${args.join(" ")}`,
			args,
			description: "test step",
			ok: false,
			exitCode: 1,
			stdout: JSON.stringify({
				ok: false,
				nextCommands: ["refarm runtime start --wait"],
			}),
			stderr: "",
			payload: {
				ok: false,
				nextCommands: ["refarm runtime start --wait"],
			},
		}));
		const agentCommand = createAgentCommand({ runRefarm });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		await agentCommand.parseAsync(["finish", "--run", "--next-command"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith("refarm runtime start --wait");
		expect(runRefarm).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(1);
		process.exitCode = originalExitCode;
		logSpy.mockRestore();
	});

	it("prints a concise human finish run report", async () => {
		const runRefarm = vi.fn((args: string[]) => ({
			id: args.join(" "),
			command: `refarm ${args.join(" ")}`,
			args,
			description: "test step",
			ok: true,
			exitCode: 0,
			stdout: JSON.stringify({ ok: true }),
			stderr: "",
			payload: { ok: true },
		}));
		const agentCommand = createAgentCommand({ runRefarm });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--run"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith("Refarm agent finish");
		expect(logSpy).toHaveBeenCalledWith(
			"PASS tidy-imports-check: refarm tidy imports --check --json",
		);
		expect(logSpy).toHaveBeenCalledWith("Finish checks passed.");
		expect(runRefarm).toHaveBeenCalledTimes(3);
		logSpy.mockRestore();
	});
});
