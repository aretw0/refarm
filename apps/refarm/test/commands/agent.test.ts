import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentCommand } from "../../src/commands/agent.js";

describe("agent command", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) {
			rmSync(tempDirs.pop()!, { recursive: true, force: true });
		}
	});

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
		expect(help).toContain("refarm runtime ensure --wait --next-command");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm doctor --next-command");
		expect(help).toContain("refarm check --next-action --json");
		expect(help).toContain("refarm check --next-command");
		expect(help).toContain("refarm tidy imports --check");
		expect(help).toContain("refarm tidy imports");
		expect(help).toContain("refarm agent finish --json");
		expect(help).toContain("refarm agent finish --templates --json");
		expect(help).toContain("refarm agent finish --lanes --json");
		expect(help).toContain("refarm agent finish --lanes --json --next-command");
		expect(help).toContain("refarm agent finish --lane after-edit --run --json");
		expect(help).toContain("refarm agent finish --lane before-push --run --json");
		expect(help).toContain("refarm agent finish --lane handoffs --run --json");
		expect(help).toContain("refarm agent finish --next-command");
		expect(help).toContain("refarm agent finish --json --next-command");
		expect(help).toContain("refarm agent finish --fix --run");
		expect(help).toContain("refarm agent finish --profile package --workspace apps/refarm --run");
		expect(help).toContain("refarm agent finish --profile affected --run");
		expect(help).toContain("refarm agent finish --profile affected --since upstream --run");
		expect(help).toContain("refarm agent finish --profile affected --include-tests --run");
		expect(help).toContain("refarm agent finish --run");
		expect(help).toContain("refarm agent finish --run --json");
		expect(help).toContain("refarm agent finish --run --next-command");
		expect(help).toContain("refarm sow");
		expect(help).toContain("refarm sow --json");
		expect(help).toContain("refarm model current");
		expect(help).toContain("refarm model providers");
		expect(help).toContain("refarm model openai/gpt-5.5");
		expect(help).toContain("refarm model base-url");
		expect(help).toContain("refarm model fallback");
		expect(help).toContain("refarm task list --json");
		expect(help).toContain("refarm resume");
		expect(help).toContain("refarm task resume");
		expect(help).toContain("refarm task run <plugin> <fn> --args '{}' --json");
		expect(help).toContain("refarm task status <effort-id> --json");
		expect(help).toContain("refarm task logs <effort-id> --json");
		expect(help).toContain("refarm plugin install");
		expect(help).toContain("refarm agent --json");
		expect(help).toContain("refarm agent --next-command");
		expect(help).toContain("refarm agent --json --next-command");
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
		expect(output).toContain("refarm runtime ensure --wait --next-command");
		expect(output).toContain("refarm doctor --next-action");
		expect(output).toContain("refarm doctor --next-command");
		expect(output).toContain("refarm check --next-action --json");
		expect(output).toContain("refarm check --next-command");
		expect(output).toContain("refarm tidy imports --check");
		expect(output).toContain("refarm tidy imports");
		expect(output).toContain("refarm sow");
		expect(output).toContain("refarm sow --json");
		expect(output).toContain("refarm model current");
		expect(output).toContain("refarm model providers");
		expect(output).toContain("refarm model base-url");
		expect(output).toContain("refarm task list --json");
		expect(output).toContain("refarm resume");
		expect(output).toContain("refarm task resume");
		expect(output).toContain("refarm task logs <effort-id> --json");
	});

	it("prints a machine-readable agent handoff plan", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			environment: { packageManager: string; codingProfile: string };
			runtime: {
				status: string;
				ensure: string;
				start: string;
				doctorCommand: string;
			};
			usage: { resume: string; tidyCheck: string; tidyApply: string };
			credentials: {
				configureInteractive: string;
				configureJson: string;
				inspectCurrent: string;
				inspectProviders: string;
				localNoKeyModel: string;
				openExternalLinks: string;
				setModel: string;
				setWorkerModel: string;
				setMonitorModel: string;
			};
			plugins: { install: string };
			workers: {
				list: string;
				resume: string;
				templates: {
					command: string;
					id: string;
					parameters: string[];
					useWhen: string;
				}[];
			};
			verification: {
				quick: string;
				quickCommand: string;
				tidyCheck: string;
				finishLanesJsonCommand: string;
				finishLanesNextJsonCommand: string;
				finishPlanJsonCommand: string;
				finishPlanNextJsonCommand: string;
				finishPlanCommand: string;
				finishRunCommand: string;
				finishFixPlanCommand: string;
				finishFixRunCommand: string;
				finishAffectedPlanJsonCommand: string;
				finishAffectedRunJsonCommand: string;
				finishAffectedUpstreamRunJsonCommand: string;
				finishAffectedTestRunJsonCommand: string;
				finishAffectedRunCommand: string;
				finishAffectedUpstreamRunCommand: string;
				finishAffectedTestRunCommand: string;
				recommended: {
					afterCommit: string;
					afterEdit: string;
					beforePush: string;
					handoffs: string;
					withPackageTests: string;
				};
				lanes: {
					command: string;
					description: string;
					id: string;
					useWhen: string;
					validationScope: string;
				}[];
				templates: {
					command: string;
					id: string;
					parameters: string[];
					useWhen: string;
				}[];
			};
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "handoff",
			environment: {
				packageManager: "refarm package-manager --json",
				codingProfile: "refarm config profile coding --local --json",
			},
			runtime: {
				status: "refarm runtime status --json",
				ensure: "refarm runtime ensure --wait --next-command",
				start: "refarm runtime start --wait --json",
				doctorCommand: "refarm doctor --next-command",
			},
			usage: {
				resume: "refarm resume --json",
				tidyCheck: "refarm tidy imports --check --json",
				tidyApply: "refarm tidy imports --json",
			},
			credentials: {
				configureInteractive: "refarm sow",
				configureJson: "refarm sow --json",
				inspectCurrent: "refarm model current --json",
				inspectProviders: "refarm model providers --json",
				localNoKeyModel: "refarm sow --model ollama/llama3.2 --json",
				openExternalLinks: "refarm config get operator.openExternalLinks --json",
				setModel: "refarm model openai/gpt-5.5 --json",
				setWorkerModel: "refarm model set --scope worker openai/gpt-5.3-codex-spark --json",
				setMonitorModel: "refarm model set --scope monitor openai/gpt-5.5 --json",
			},
			plugins: { install: "refarm plugin install --json" },
			workers: {
				list: "refarm task list --json",
				resume: "refarm task resume --json",
				templates: expect.arrayContaining([
					expect.objectContaining({
						id: "worker-task-run",
						command: "refarm task run <plugin> <fn> --args '{}' --json",
						parameters: ["plugin", "fn"],
					}),
					expect.objectContaining({
						id: "worker-task-status",
						command: "refarm task status <effort-id> --json",
						parameters: ["effort-id"],
					}),
					expect.objectContaining({
						id: "worker-task-logs",
						command: "refarm task logs <effort-id> --json",
						parameters: ["effort-id"],
					}),
				]),
			},
			verification: {
				quick: "refarm check --next-action --json",
				quickCommand: "refarm check --next-command",
				tidyCheck: "refarm tidy imports --check --json",
				finishTemplatesJsonCommand: "refarm agent finish --templates --json",
				finishLanesJsonCommand: "refarm agent finish --lanes --json",
				finishLanesNextJsonCommand: "refarm agent finish --lanes --json --next-command",
				finishPlanJsonCommand: "refarm agent finish --json",
				finishPlanNextJsonCommand: "refarm agent finish --json --next-command",
				finishPlanCommand: "refarm agent finish --next-command",
				finishRunCommand: "refarm agent finish --run --next-command",
				finishFixPlanCommand: "refarm agent finish --fix --next-command",
				finishFixRunCommand: "refarm agent finish --fix --run --next-command",
				finishAffectedPlanJsonCommand: "refarm agent finish --profile affected --json",
				finishAffectedRunJsonCommand: "refarm agent finish --profile affected --run --json",
				finishAffectedUpstreamRunJsonCommand: "refarm agent finish --profile affected --since upstream --run --json",
				finishAffectedTestRunJsonCommand: "refarm agent finish --profile affected --include-tests --run --json",
				finishAffectedRunCommand: "refarm agent finish --profile affected --run --next-command",
				finishAffectedUpstreamRunCommand: "refarm agent finish --profile affected --since upstream --run --next-command",
				finishAffectedTestRunCommand: "refarm agent finish --profile affected --include-tests --run --next-command",
				recommended: {
					afterEdit: "refarm agent finish --lane after-edit --run --json",
					afterCommit: "refarm agent finish --lane after-commit --run --json",
					beforePush: "refarm agent finish --lane before-push --run --json",
					handoffs: "refarm agent finish --lane handoffs --run --json",
					withPackageTests: "refarm agent finish --lane with-package-tests --run --json",
				},
				lanes: [
					expect.objectContaining({
						id: "after-edit",
						command: "refarm agent finish --lane after-edit --run --json",
						useWhen: "After source edits, before an atomic commit.",
						validationScope: "dirtyTree",
					}),
					expect.objectContaining({
						id: "after-commit",
						command: "refarm agent finish --lane after-commit --run --json",
						validationScope: "lastCommit",
					}),
					expect.objectContaining({
						id: "before-push",
						command: "refarm agent finish --lane before-push --run --json",
						validationScope: "branchRange",
					}),
					expect.objectContaining({
						id: "handoffs",
						command: "refarm agent finish --lane handoffs --run --json",
						useWhen: "After changing public JSON output, nextCommands, or agent handoffs.",
						validationScope: "contract",
					}),
					expect.objectContaining({
						id: "with-package-tests",
						command: "refarm agent finish --lane with-package-tests --run --json",
						validationScope: "dirtyTree",
					}),
				],
				templates: expect.arrayContaining([
					expect.objectContaining({
						id: "package-workspace-plan",
						command: "refarm agent finish --profile package --workspace <dir> --next-command",
						parameters: ["dir"],
						useWhen: "Validate a known workspace/package directory without using Git status.",
					}),
					expect.objectContaining({
						id: "affected-since-ref-run-json",
						command: "refarm agent finish --profile affected --since <ref> --run --json",
						parameters: ["ref"],
						useWhen: "Validate affected workspaces against an explicit Git ref.",
					}),
				]),
			},
			nextAction: "refarm check --next-action --json",
			nextCommand: "refarm check --next-command",
		});
		expect(payload.nextActions).toContain("refarm runtime status --json");
		expect(payload.nextActions).toContain("refarm runtime ensure --wait --next-command");
		expect(payload.nextActions).toContain("refarm package-manager --json");
		expect(payload.nextActions).toContain("refarm config profile coding --local --json");
		expect(payload.nextActions).toContain("refarm model providers --json");
		expect(payload.nextActions).toContain("refarm task list --json");
		expect(payload.nextActions).toContain("refarm resume --json");
		expect(payload.nextActions).toContain("refarm task resume --json");
		expect(payload.nextActions).toContain("refarm agent finish --templates --json");
		expect(payload.nextActions).toContain("refarm agent finish --lanes --json");
		expect(payload.nextActions).toContain("refarm agent finish --lanes --json --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --lane handoffs --run --json");
		expect(payload.nextActions).toContain("refarm agent finish --json");
		expect(payload.nextActions).toContain("refarm agent finish --json --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --fix --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --json");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --run --json");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --since upstream --run --json");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --run --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --since upstream --run --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --include-tests --run --next-command");
		expect(payload.nextActions.some((action) => /<[^>]+>/.test(action))).toBe(false);
		expect(payload.nextCommands).toEqual([
			"refarm check --next-command",
			"refarm runtime ensure --wait --next-command",
			"refarm resume --json",
			"refarm sow --model ollama/llama3.2 --json",
			"refarm sow --json",
			"refarm model current --json",
			"refarm package-manager --json",
			"refarm config profile coding --local --json",
			"refarm task list --json",
			"refarm task resume --json",
			"refarm agent finish --templates --json",
			"refarm agent finish --lanes --json",
			"refarm agent finish --lanes --json --next-command",
			"refarm agent finish --lane handoffs --run --json",
			"refarm agent finish --json",
			"refarm agent finish --json --next-command",
			"refarm agent finish --next-command",
			"refarm agent finish --fix --next-command",
			"refarm agent finish --profile affected --json",
			"refarm agent finish --profile affected --run --json",
			"refarm agent finish --profile affected --since upstream --run --json",
			"refarm agent finish --profile affected --run --next-command",
			"refarm agent finish --profile affected --since upstream --run --next-command",
			"refarm agent finish --profile affected --include-tests --run --next-command",
		]);
		expect(payload.nextCommands.some((command) => /<[^>]+>/.test(command))).toBe(false);
		const stripTemplates = (value: unknown): unknown => {
			if (Array.isArray(value)) return value.map(stripTemplates);
			if (!value || typeof value !== "object") return value;
			return Object.fromEntries(
				Object.entries(value)
					.map(([key, entry]) => [
						key,
						key === "templates" ? [] : stripTemplates(entry),
					]),
			);
		};
		const payloadWithoutTemplates = stripTemplates(payload);
		expect(JSON.stringify(payloadWithoutTemplates)).not.toMatch(/<[^>]+>/);
		logSpy.mockRestore();
	});

	it("prints the first agent handoff command without JSON parsing", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["--next-command"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith("refarm check --next-command");
		logSpy.mockRestore();
	});

	it("prints the first agent handoff action without JSON parsing", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["--next-action"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith("refarm check --next-action --json");
		logSpy.mockRestore();
	});

	it("prints the first agent handoff command as JSON when requested", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["--json", "--next-command"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			nextAction: string;
			nextCommand: string;
			nextCommands: string[];
			status: string;
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "handoff",
			nextAction: "refarm check --next-action --json",
			nextCommand: "refarm check --next-command",
			nextCommands: ["refarm check --next-command"],
		});
		logSpy.mockRestore();
	});

	it("prints the first agent handoff action as JSON when requested", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["--json", "--next-action"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			status: string;
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "handoff",
			nextAction: "refarm check --next-action --json",
			nextActions: ["refarm check --next-action --json"],
			nextCommand: "refarm check --next-command",
		});
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
				effect?: string;
			}[];
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
			effects: string[];
			writes: boolean;
			selection: {
				profile: string;
				fix: boolean;
				includeTests: boolean;
				lane: string | null;
				validationScope: string;
				workspace: string | null;
			};
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "plan",
			effects: ["verify", "observe"],
			writes: false,
			selection: {
				profile: "quick",
				fix: false,
				includeTests: false,
				lane: null,
				validationScope: "quick",
				workspace: null,
			},
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
				effect: "verify",
			}),
			expect.objectContaining({
				id: "health",
				command: "refarm health --next-action --json",
				args: ["health", "--next-action", "--json"],
				effect: "observe",
			}),
			expect.objectContaining({
				id: "check",
				command: "refarm check --next-action --json",
				args: ["check", "--next-action", "--json"],
				effect: "verify",
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

	it("prints the next finish command as JSON when requested", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--json", "--next-command"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			nextCommand: string;
			selection: { validationScope: string };
			status: string;
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "plan",
			nextCommand: "refarm tidy imports --check --json",
			selection: { validationScope: "quick" },
		});
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

	it("prints finish lanes as a focused JSON handoff", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--lanes", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			lanes: { command: string; id: string; useWhen: string; validationScope: string }[];
			nextCommands: string[];
			recommended: { afterEdit: string };
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "lanes",
			recommended: {
				afterEdit: "refarm agent finish --lane after-edit --run --json",
			},
		});
		expect(payload.lanes).toEqual([
			expect.objectContaining({
				id: "after-edit",
				command: "refarm agent finish --lane after-edit --run --json",
				useWhen: "After source edits, before an atomic commit.",
				validationScope: "dirtyTree",
			}),
			expect.objectContaining({
				id: "after-commit",
				command: "refarm agent finish --lane after-commit --run --json",
				validationScope: "lastCommit",
			}),
			expect.objectContaining({
				id: "before-push",
				command: "refarm agent finish --lane before-push --run --json",
				validationScope: "branchRange",
			}),
			expect.objectContaining({
				id: "handoffs",
				command: "refarm agent finish --lane handoffs --run --json",
				useWhen: "After changing public JSON output, nextCommands, or agent handoffs.",
				validationScope: "contract",
			}),
			expect.objectContaining({
				id: "with-package-tests",
				command: "refarm agent finish --lane with-package-tests --run --json",
				validationScope: "dirtyTree",
			}),
		]);
		expect(payload.nextCommands).toContain("refarm agent finish --lane before-push --run --json");
		expect(payload.nextCommands).toContain("refarm agent finish --lane handoffs --run --json");
		logSpy.mockRestore();
	});

	it("prints finish templates as a focused JSON handoff", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--templates", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			operation: string;
			status: string;
			nextAction: string;
			nextCommand: string | null;
			nextCommands: string[];
			templates: { command: string; id: string; parameters: string[]; useWhen: string }[];
		};
		expect(payload).toMatchObject({
			ok: true,
			operation: "finish-templates",
			status: "templates",
			nextAction: "Substitute template parameters before executing a finish command.",
			nextCommand: null,
			nextCommands: [],
		});
		expect(payload.templates).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "package-workspace-plan",
				command: "refarm agent finish --profile package --workspace <dir> --next-command",
				parameters: ["dir"],
				useWhen: "Validate a known workspace/package directory without using Git status.",
			}),
			expect.objectContaining({
				id: "affected-since-ref-run-json",
				command: "refarm agent finish --profile affected --since <ref> --run --json",
				parameters: ["ref"],
				useWhen: "Validate affected workspaces against an explicit Git ref.",
			}),
		]));
		logSpy.mockRestore();
	});

	it("prints operator finish lanes with usage guidance", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--lanes"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith(
			"after-edit: refarm agent finish --lane after-edit --run --json",
		);
		expect(logSpy).toHaveBeenCalledWith("  Validate the current dirty tree after source edits.");
		expect(logSpy).toHaveBeenCalledWith("  Use when: After source edits, before an atomic commit.");
		expect(logSpy).toHaveBeenCalledWith(
			"  Use when: After changing public JSON output, nextCommands, or agent handoffs.",
		);
		logSpy.mockRestore();
	});

	it("prints operator finish templates with substitution guidance", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--templates"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith(
			"package-workspace-plan: refarm agent finish --profile package --workspace <dir> --next-command",
		);
		expect(logSpy).toHaveBeenCalledWith("  Parameters: dir");
		expect(logSpy).toHaveBeenCalledWith(
			"  Use when: Validate a known workspace/package directory without using Git status.",
		);
		expect(logSpy).toHaveBeenCalledWith(
			"affected-since-ref-run-json: refarm agent finish --profile affected --since <ref> --run --json",
		);
		expect(logSpy).toHaveBeenCalledWith("  Parameters: ref");
		logSpy.mockRestore();
	});

	it("prints finish template next action without JSON", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--templates", "--next-action"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith(
			"Substitute template parameters before executing a finish command.",
		);
		logSpy.mockRestore();
	});

	it("prints the next finish lane command as JSON when requested", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync([
			"finish",
			"--lanes",
			"--json",
			"--next-command",
		], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			nextCommand: string;
			status: string;
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "lanes",
			nextCommand: "refarm agent finish --lane after-edit --run --json",
		});
		logSpy.mockRestore();
	});

	it("rejects ambiguous finish lane catalog combinations", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		try {
			await agentCommand.parseAsync([
				"finish",
				"--lanes",
				"--lane",
				"after-edit",
				"--json",
			], { from: "user" });
		} finally {
			process.exitCode = originalExitCode;
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			message: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			message: "--lanes cannot be combined with --lane. Choose a lane after listing them.",
			nextCommand: "refarm agent finish --help",
		});
		logSpy.mockRestore();
	});

	it("rejects executable finish template catalog combinations", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		try {
			await agentCommand.parseAsync(["finish", "--templates", "--run", "--json"], {
				from: "user",
			});
		} finally {
			process.exitCode = originalExitCode;
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			message: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			message: "--templates cannot be combined with --run.",
			nextCommand: "refarm agent finish --help",
		});
		logSpy.mockRestore();
	});

	it("rejects finish template next-command requests", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		try {
			await agentCommand.parseAsync(["finish", "--templates", "--next-command", "--json"], {
				from: "user",
			});
		} finally {
			process.exitCode = originalExitCode;
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			message: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			message:
				"--templates does not provide an executable next command. Use --templates --json or --templates --next-action.",
			nextCommand: "refarm agent finish --help",
		});
		logSpy.mockRestore();
	});

	it("rejects since outside the affected finish profile", async () => {
		const agentCommand = createAgentCommand();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		try {
			await agentCommand.parseAsync(["finish", "--since", "HEAD~1"], {
				from: "user",
			});
		} finally {
			process.exitCode = originalExitCode;
		}

		expect(errorSpy).toHaveBeenCalledWith("--since only applies to --profile affected.");
		errorSpy.mockRestore();
	});

	it("prints finish option errors as JSON when requested", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		try {
			await agentCommand.parseAsync(["finish", "--since", "HEAD~1", "--json"], {
				from: "user",
			});
		} finally {
			process.exitCode = originalExitCode;
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			message: string;
			nextActions: string[];
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "invalid-agent-finish-options",
			message: "--since only applies to --profile affected.",
			nextCommand: "refarm agent finish --help",
		});
		logSpy.mockRestore();
	});

	it("rejects ambiguous finish lane combinations", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		try {
			await agentCommand.parseAsync([
				"finish",
				"--lane",
				"after-edit",
				"--include-tests",
				"--json",
			], { from: "user" });
		} finally {
			process.exitCode = originalExitCode;
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			message: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			message: "--lane cannot be combined with --include-tests. Use --lane with-package-tests or explicit profile flags.",
			nextCommand: "refarm agent finish --help",
		});
		logSpy.mockRestore();
	});

	it("prints finish lane errors as JSON when requested", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		try {
			await agentCommand.parseAsync(["finish", "--lane", "unknown", "--json"], {
				from: "user",
			});
		} finally {
			process.exitCode = originalExitCode;
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			message: string;
			nextActions: string[];
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			message: "Unknown finish lane: unknown. Use: after-edit | after-commit | before-push | handoffs | with-package-tests",
			nextCommand: "refarm agent finish --help",
		});
		expect(payload.nextActions).toEqual([
			"Run `refarm agent finish --help` and choose a valid finish lane or profile.",
		]);
		logSpy.mockRestore();
	});

	it("adds package validation steps from workspace scripts", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync([
			"finish",
			"--profile",
			"package",
			"--workspace",
			"apps/refarm",
			"--json",
		], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			steps: { id: string; command: string; process?: { packageManager?: string | null } }[];
			nextCommands: string[];
		};

		expect(payload.ok).toBe(true);
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
			"package-type-check",
			"package-lint",
			"package-build",
		]);
		expect(payload.nextCommands).toContain("pnpm -C apps/refarm run type-check");
		expect(payload.nextCommands).toContain("pnpm -C apps/refarm run lint");
		expect(payload.nextCommands).toContain("pnpm -C apps/refarm run build");
		expect(payload.steps.at(-1)?.process?.packageManager).toBe("pnpm");
		logSpy.mockRestore();
	});

	it("runs package validation steps with process runner", async () => {
		const runRefarm = vi.fn((args: string[]) => ({
			id: args.join(" "),
			command: `refarm ${args.join(" ")}`,
			args,
			description: "test refarm step",
			ok: true,
			exitCode: 0,
			stdout: JSON.stringify({ ok: true }),
			stderr: "",
			payload: { ok: true },
		}));
		const runProcess = vi.fn((step) => ({
			...step,
			ok: true,
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));
		const agentCommand = createAgentCommand({ runRefarm, runProcess });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync([
			"finish",
			"--profile",
			"package",
			"--workspace",
			"apps/refarm",
			"--run",
			"--json",
		], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			steps: { id: string; ok: boolean }[];
		};
		expect(payload.ok).toBe(true);
		expect(runRefarm).toHaveBeenCalledTimes(3);
		expect(runProcess).toHaveBeenCalledTimes(3);
		expect(payload.steps.map((step) => step.id)).toContain("package-type-check");
		logSpy.mockRestore();
	});

	it("adds JSON handoff contract validation in the handoffs finish lane", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync([
			"finish",
			"--lane",
			"handoffs",
			"--json",
		], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			selection: { lane: string | null; profile: string; validationScope: string };
			steps: { id: string; command: string; process?: { packageManager?: string | null } }[];
			nextCommands: string[];
		};

		expect(payload.ok).toBe(true);
		expect(payload.selection).toMatchObject({
			lane: "handoffs",
			profile: "quick",
			validationScope: "contract",
		});
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
			"handoffs-test-handoffs",
		]);
		expect(payload.nextCommands).toContain("pnpm -C apps/refarm run test:handoffs");
		expect(payload.steps.at(-1)?.process?.packageManager).toBe("pnpm");
		logSpy.mockRestore();
	});

	it("runs JSON handoff contract validation in the handoffs finish lane", async () => {
		const runRefarm = vi.fn((args: string[]) => ({
			id: args.join(" "),
			command: `refarm ${args.join(" ")}`,
			args,
			description: "test refarm step",
			ok: true,
			exitCode: 0,
			stdout: JSON.stringify({ ok: true }),
			stderr: "",
			payload: { ok: true },
		}));
		const runProcess = vi.fn((step) => ({
			...step,
			ok: true,
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));
		const agentCommand = createAgentCommand({ runRefarm, runProcess });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync([
			"finish",
			"--lane",
			"handoffs",
			"--run",
			"--json",
		], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			selection: { lane: string | null; validationScope: string };
			steps: { id: string; ok: boolean }[];
		};
		expect(payload.ok).toBe(true);
		expect(payload.selection).toMatchObject({
			lane: "handoffs",
			validationScope: "contract",
		});
		expect(runRefarm).toHaveBeenCalledTimes(3);
		expect(runProcess).toHaveBeenCalledTimes(1);
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
			"handoffs-test-handoffs",
		]);
		logSpy.mockRestore();
	});

	it("resolves package profile workspaces from git root when invoked in a subdirectory", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-root-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(appDir, { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { "type-check": "tsc --noEmit" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		const originalCwd = process.cwd();
		process.chdir(appDir);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"package",
				"--workspace",
				"apps/refarm",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string; process?: { cwd?: string } }[];
		};
		const typeCheck = payload.steps.find((step) => step.id === "package-type-check");
		expect(typeCheck?.command).toBe("npm --prefix apps/refarm run type-check");
		expect(typeCheck?.process?.cwd).toBe(root);
		logSpy.mockRestore();
	});

	it("resolves package profile workspaces from package.json workspaces outside git", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-workspaces-"));
		tempDirs.push(root);
		writeFileSync(
			path.join(root, "package.json"),
			JSON.stringify({
				private: true,
				workspaces: ["apps/*"],
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(appDir, { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { "type-check": "tsc --noEmit" },
			}),
			"utf8",
		);
		const originalCwd = process.cwd();
		process.chdir(appDir);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"package",
				"--workspace",
				"apps/refarm",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string; process?: { cwd?: string } }[];
		};
		const typeCheck = payload.steps.find((step) => step.id === "package-type-check");
		expect(typeCheck?.command).toBe("npm --prefix apps/refarm run type-check");
		expect(typeCheck?.process?.cwd).toBe(root);
		logSpy.mockRestore();
	});

	it("adds package validation steps for affected git workspaces", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-affected-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(path.join(appDir, "src"), { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { "type-check": "tsc --noEmit", lint: "eslint .", test: "vitest run" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		writeFileSync(path.join(appDir, "src", "index.ts"), "export {};\n", "utf8");
		const originalCwd = process.cwd();
		process.chdir(appDir);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string; process?: { cwd?: string } }[];
			nextCommands: string[];
			selection: {
				affectedWorkspaces?: string[];
				includeTests: boolean;
				lane: string | null;
				profile: string;
				validationScope: string;
			};
		};
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
			"package-apps-refarm-type-check",
			"package-apps-refarm-lint",
		]);
		expect(payload.nextCommands).toContain("npm --prefix apps/refarm run type-check");
		expect(payload.nextCommands).toContain("npm --prefix apps/refarm run lint");
		expect(payload.nextCommands).not.toContain("npm --prefix apps/refarm run test");
		expect(payload.selection).toMatchObject({
			profile: "affected",
			includeTests: false,
			lane: null,
			validationScope: "dirtyTree",
			affectedWorkspaces: ["apps/refarm"],
		});
		expect(payload.steps.at(-1)?.process?.cwd).toBe(root);
		logSpy.mockRestore();
	});

	it("adds affected workspace steps from committed changes since a git ref", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-since-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(path.join(appDir, "src"), { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { "type-check": "tsc --noEmit", lint: "eslint ." },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		writeFileSync(path.join(appDir, "src", "index.ts"), "export const value = 1;\n", "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"initial",
		], { cwd: root, stdio: "ignore" });
		writeFileSync(path.join(appDir, "src", "index.ts"), "export const value = 2;\n", "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"change app",
		], { cwd: root, stdio: "ignore" });
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--since",
				"HEAD~1",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string }[];
			selection: {
				affectedWorkspaces?: string[];
				lane: string | null;
				since: string | null;
				sinceRef: string | null;
				validationScope: string;
			};
		};
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
			"package-apps-refarm-type-check",
			"package-apps-refarm-lint",
		]);
		expect(payload.selection).toMatchObject({
			since: "HEAD~1",
			sinceRef: "HEAD~1",
			lane: null,
			validationScope: "branchRange",
			affectedWorkspaces: ["apps/refarm"],
		});
		logSpy.mockRestore();
	});

	it("expands the after-edit finish lane to affected dirty-tree validation", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-lane-edit-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(path.join(appDir, "src"), { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { "type-check": "tsc --noEmit" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		writeFileSync(path.join(appDir, "src", "index.ts"), "export const value = 1;\n", "utf8");
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--lane",
				"after-edit",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			selection: {
				affectedWorkspaces?: string[];
				lane: string | null;
				profile: string;
				validationScope: string;
			};
		};
		expect(payload.selection).toMatchObject({
			affectedWorkspaces: ["apps/refarm"],
			lane: "after-edit",
			profile: "affected",
			validationScope: "dirtyTree",
		});
		logSpy.mockRestore();
	});

	it("resolves upstream as the affected branch base", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-upstream-"));
		tempDirs.push(root);
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(path.join(appDir, "src"), { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { "type-check": "tsc --noEmit" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		writeFileSync(path.join(appDir, "src", "index.ts"), "export const value = 1;\n", "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"initial",
		], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
			cwd: root,
			stdio: "ignore",
		});
		execFileSync("git", ["remote", "add", "origin", "https://example.invalid/refarm.git"], {
			cwd: root,
			stdio: "ignore",
		});
		execFileSync("git", ["branch", "--set-upstream-to=origin/main", "main"], {
			cwd: root,
			stdio: "ignore",
		});
		writeFileSync(path.join(appDir, "src", "index.ts"), "export const value = 2;\n", "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"change app",
		], { cwd: root, stdio: "ignore" });
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--since",
				"upstream",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			selection: {
				affectedWorkspaces?: string[];
				lane: string | null;
				since: string | null;
				sinceRef: string | null;
				validationScope: string;
			};
		};
		expect(payload.selection).toMatchObject({
			since: "upstream",
			sinceRef: "origin/main",
			lane: null,
			validationScope: "branchRange",
			affectedWorkspaces: ["apps/refarm"],
		});
		logSpy.mockRestore();
	});

	it("expands the after-commit finish lane to the most recent commit", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-lane-commit-"));
		tempDirs.push(root);
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(path.join(appDir, "src"), { recursive: true });
		mkdirSync(path.join(root, "docs"), { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { "type-check": "tsc --noEmit" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		writeFileSync(path.join(appDir, "src", "index.ts"), "export const value = 1;\n", "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"initial",
		], { cwd: root, stdio: "ignore" });
		writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\n", "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"docs",
		], { cwd: root, stdio: "ignore" });
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--lane",
				"after-commit",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string }[];
			nextCommands: string[];
			selection: {
				affectedWorkspaces?: string[];
				lane: string | null;
				since: string | null;
				sinceRef: string | null;
				validationScope: string;
			};
		};
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
		]);
		expect(payload.nextCommands).not.toContain("npm --prefix apps/refarm run type-check");
		expect(payload.selection).toMatchObject({
			affectedWorkspaces: [],
			lane: "after-commit",
			since: "HEAD~1",
			sinceRef: "HEAD~1",
			validationScope: "lastCommit",
		});
		logSpy.mockRestore();
	});

	it("expands the before-push finish lane to upstream branch validation", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-lane-push-"));
		tempDirs.push(root);
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(path.join(appDir, "src"), { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { "type-check": "tsc --noEmit" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		writeFileSync(path.join(appDir, "src", "index.ts"), "export const value = 1;\n", "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"initial",
		], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
			cwd: root,
			stdio: "ignore",
		});
		execFileSync("git", ["remote", "add", "origin", "https://example.invalid/refarm.git"], {
			cwd: root,
			stdio: "ignore",
		});
		execFileSync("git", ["branch", "--set-upstream-to=origin/main", "main"], {
			cwd: root,
			stdio: "ignore",
		});
		writeFileSync(path.join(appDir, "src", "index.ts"), "export const value = 2;\n", "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"change app",
		], { cwd: root, stdio: "ignore" });
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--lane",
				"before-push",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			selection: {
				affectedWorkspaces?: string[];
				lane: string | null;
				since: string | null;
				sinceRef: string | null;
				validationScope: string;
			};
		};
		expect(payload.selection).toMatchObject({
			affectedWorkspaces: ["apps/refarm"],
			lane: "before-push",
			since: "upstream",
			sinceRef: "origin/main",
			validationScope: "branchRange",
		});
		logSpy.mockRestore();
	});

	it("reports a JSON recovery when upstream is missing", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-no-upstream-"));
		tempDirs.push(root);
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
		writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "root" }), "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"initial",
		], { cwd: root, stdio: "ignore" });
		const originalCwd = process.cwd();
		const originalExitCode = process.exitCode;
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--since",
				"upstream",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
			process.exitCode = originalExitCode;
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			message: string;
			nextActions: string[];
			nextCommands: string[];
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "invalid-agent-finish-since-ref",
			nextCommand: "refarm agent finish --profile affected --json",
		});
		expect(payload.message).toContain("Could not resolve upstream");
		expect(payload.message).toContain("--since <ref>");
		expect(payload.nextActions).toEqual([
			"Run the dirty-tree affected fallback while choosing an explicit Git ref or configuring upstream.",
			"Pass an explicit Git ref with `refarm agent finish --profile affected --since <ref> --json`.",
			"Configure the current branch upstream, then retry `refarm agent finish --profile affected --since upstream --json`.",
		]);
		expect(payload.nextCommands).toEqual([
			"refarm agent finish --profile affected --json",
			"refarm agent finish --help",
		]);
		logSpy.mockRestore();
	});

	it("preserves run intent in missing upstream JSON recovery", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-run-no-upstream-"));
		tempDirs.push(root);
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
		writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "root" }), "utf8");
		execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
		execFileSync("git", [
			"-c",
			"user.name=Refarm Test",
			"-c",
			"user.email=refarm-test@example.com",
			"commit",
			"-m",
			"initial",
		], { cwd: root, stdio: "ignore" });
		const originalCwd = process.cwd();
		const originalExitCode = process.exitCode;
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--since",
				"upstream",
				"--run",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
			process.exitCode = originalExitCode;
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "invalid-agent-finish-since-ref",
			nextCommand: "refarm agent finish --profile affected --run --json",
		});
		expect(payload.nextCommands).toEqual([
			"refarm agent finish --profile affected --run --json",
			"refarm agent finish --help",
		]);
		logSpy.mockRestore();
	});

	it("adds import organizer validation for affected script changes", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-scripts-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		mkdirSync(path.join(root, "scripts"), { recursive: true });
		writeFileSync(
			path.join(root, "scripts", "organize-imports-lib.mjs"),
			"export const changed = true;\n",
			"utf8",
		);
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string; process?: { command?: string } }[];
			selection: {
				affectedScriptChecks?: string[];
				affectedWorkspaces?: string[];
			};
		};
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
			"script-organize-imports-test",
		]);
		expect(payload.steps.at(-1)?.command).toBe(
			"node --test scripts/ci/test-organize-imports-lib.mjs",
		);
		expect(payload.steps.at(-1)?.process?.command).toBe("node");
		expect(payload.selection.affectedScriptChecks).toEqual(["organize-imports"]);
		expect(payload.selection.affectedWorkspaces).toEqual([]);
		logSpy.mockRestore();
	});

	it("adds no-token agent e2e smoke for affected runtime model paths", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-agent-smoke-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		writeFileSync(
			path.join(root, "package.json"),
			JSON.stringify({
				name: "root",
				scripts: { "refarm:agent:e2e:mock": "node scripts/ci/smoke-refarm-agent-model-mock.mjs" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		mkdirSync(path.join(root, "packages", "tractor", "src", "host", "wasi_bridge"), {
			recursive: true,
		});
		writeFileSync(
			path.join(root, "packages", "tractor", "src", "host", "wasi_bridge", "core.rs"),
			"pub fn changed() {}\n",
			"utf8",
		);
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string; process?: { command?: string } }[];
			selection: {
				affectedScriptChecks?: string[];
				affectedWorkspaces?: string[];
			};
		};
		logSpy.mockRestore();

		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
			"script-refarm-agent-e2e-mock",
		]);
		expect(payload.steps.at(-1)?.command).toContain("run refarm:agent:e2e:mock");
		expect(payload.steps.at(-1)?.process?.command).toBe("npm");
		expect(payload.selection.affectedScriptChecks).toEqual(["agent-e2e-mock"]);
		expect(payload.selection.affectedWorkspaces).toEqual([]);
	});

	it("adds package test scripts only when requested", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-tests-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(path.join(appDir, "src"), { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { lint: "eslint .", test: "vitest run", build: "tsc" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		writeFileSync(path.join(appDir, "src", "index.ts"), "export {};\n", "utf8");
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--include-tests",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string }[];
			nextCommands: string[];
			selection: {
				affectedWorkspaces?: string[];
				includeTests: boolean;
				validationScope: string;
			};
		};
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
			"package-apps-refarm-lint",
			"package-apps-refarm-test",
			"package-apps-refarm-build",
		]);
		expect(payload.nextCommands).toContain("npm --prefix apps/refarm run test");
		expect(payload.selection).toMatchObject({
			includeTests: true,
			validationScope: "dirtyTree",
			affectedWorkspaces: ["apps/refarm"],
		});
		logSpy.mockRestore();
	});

	it("does not add root package scripts for repository-level affected files", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-root-docs-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		writeFileSync(
			path.join(root, "package.json"),
			JSON.stringify({
				name: "root",
				scripts: { "type-check": "turbo type-check" },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		mkdirSync(path.join(root, "docs"), { recursive: true });
		writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\n", "utf8");
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--json",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			steps: { id: string; command: string }[];
			nextCommands: string[];
			selection: { affectedWorkspaces?: string[]; validationScope: string };
		};
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
		]);
		expect(payload.nextCommands).not.toContain("npm --prefix . run type-check");
		expect(payload.selection.affectedWorkspaces).toEqual([]);
		expect(payload.selection.validationScope).toBe("dirtyTree");
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
		const finishRecorder = {
			rememberRun: vi.fn(),
			getCheckpoint: vi.fn(),
			getLatest: vi.fn(),
		};
		const agentCommand = createAgentCommand({ runRefarm, finishRecorder });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--run", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			steps: { ok: boolean; args: string[] }[];
			failedStepId: string | null;
			failedCommand: string | null;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "passed",
			failedStepId: null,
			failedCommand: null,
			nextCommand: "refarm resume --json",
			nextCommands: ["refarm resume --json"],
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
		expect(finishRecorder.rememberRun).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "passed",
				command: "refarm agent finish --run --json",
				profile: "quick",
				lane: null,
				validationScope: "quick",
				nextCommands: [],
			}),
		);
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
			steps: { id: string; args: string[]; effect?: string }[];
			effects: string[];
			writes: boolean;
		};
		expect(payload.ok).toBe(true);
		expect(payload.effects).toEqual(["write", "verify", "observe"]);
		expect(payload.writes).toBe(true);
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports",
			"tidy-imports-check",
			"health",
			"check",
		]);
		expect(payload.steps[0]?.args).toEqual(["tidy", "imports", "--json"]);
		expect(payload.steps[0]?.effect).toBe("write");
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
			failedStepId: string | null;
			failedCommand: string | null;
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			status: "failed",
			failedStepId: "health",
			failedCommand: "refarm health --next-action --json",
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

	it("prints the next recovery action for failing finish runs", async () => {
		const runRefarm = vi.fn((args: string[]) => ({
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

		await agentCommand.parseAsync(["finish", "--run", "--next-action"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith("Start the runtime before running the full check.");
		expect(runRefarm).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(1);
		process.exitCode = originalExitCode;
		logSpy.mockRestore();
	});

	it("prints a concise operator finish run report", async () => {
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
		expect(logSpy).toHaveBeenCalledWith("Selection: quick");
		expect(logSpy).toHaveBeenCalledWith(
			"PASS tidy-imports-check: refarm tidy imports --check --json",
		);
		expect(logSpy).toHaveBeenCalledWith("Finish checks passed.");
		expect(runRefarm).toHaveBeenCalledTimes(3);
		logSpy.mockRestore();
	});

	it("prints remaining finish commands after a operator failure report", async () => {
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
					nextCommands: ["refarm runtime ensure --wait --next-command"],
				}),
				stderr: "",
				payload: {
					ok: false,
					nextCommands: ["refarm runtime ensure --wait --next-command"],
				},
			}));
		const agentCommand = createAgentCommand({ runRefarm });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const originalExitCode = process.exitCode;

		await agentCommand.parseAsync(["finish", "--run"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			"FAIL health: refarm health --next-action --json",
		);
		expect(logSpy).toHaveBeenCalledWith(
			"Next command: refarm runtime ensure --wait --next-command",
		);
		expect(logSpy).toHaveBeenCalledWith("Remaining commands:");
		expect(logSpy).toHaveBeenCalledWith("  refarm check --next-action --json");
		expect(runRefarm).toHaveBeenCalledTimes(2);
		expect(process.exitCode).toBe(1);
		process.exitCode = originalExitCode;
		logSpy.mockRestore();
	});

	it("prints selected affected workspaces in operator finish reports", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-operator-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		const appDir = path.join(root, "apps", "refarm");
		mkdirSync(path.join(appDir, "src"), { recursive: true });
		writeFileSync(
			path.join(appDir, "package.json"),
			JSON.stringify({
				name: "refarm-test",
				scripts: { lint: "eslint ." },
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		writeFileSync(path.join(appDir, "src", "index.ts"), "export {};\n", "utf8");
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
		const runProcess = vi.fn((step) => ({
			...step,
			ok: true,
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand({ runRefarm, runProcess });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--run",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		expect(logSpy).toHaveBeenCalledWith("Selection: affected (apps/refarm)");
		logSpy.mockRestore();
	});

	it("prints affected script checks in operator finish reports", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-scripts-operator-"));
		tempDirs.push(root);
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		mkdirSync(path.join(root, "scripts"), { recursive: true });
		writeFileSync(
			path.join(root, "scripts", "organize-imports-lib.mjs"),
			"export const changed = true;\n",
			"utf8",
		);
		const runProcess = vi.fn((step) => ({
			...step,
			ok: true,
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));
		const originalCwd = process.cwd();
		process.chdir(root);
		const agentCommand = createAgentCommand({ runProcess });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await agentCommand.parseAsync([
				"finish",
				"--profile",
				"affected",
				"--run",
			], { from: "user" });
		} finally {
			process.chdir(originalCwd);
		}

		expect(logSpy).toHaveBeenCalledWith(
			"Selection: affected (scripts: organize-imports)",
		);
		logSpy.mockRestore();
	});
});
