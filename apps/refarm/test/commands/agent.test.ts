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
		expect(help).toContain("refarm agent finish --next-command");
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
			usage: { tidyCheck: string; tidyApply: string };
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
			verification: {
				quick: string;
				quickCommand: string;
				tidyCheck: string;
				finishPlanCommand: string;
				finishRunCommand: string;
				finishFixPlanCommand: string;
				finishFixRunCommand: string;
				finishPackagePlanCommand: string;
				finishPackageRunCommand: string;
				finishPackageFixRunCommand: string;
				finishAffectedPlanJsonCommand: string;
				finishAffectedRunJsonCommand: string;
				finishAffectedUpstreamRunJsonCommand: string;
				finishAffectedSinceRunJsonCommand: string;
				finishAffectedTestRunJsonCommand: string;
				finishAffectedRunCommand: string;
				finishAffectedUpstreamRunCommand: string;
				finishAffectedSinceRunCommand: string;
				finishAffectedTestRunCommand: string;
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
			verification: {
				quick: "refarm check --next-action --json",
				quickCommand: "refarm check --next-command",
				tidyCheck: "refarm tidy imports --check --json",
				finishPlanCommand: "refarm agent finish --next-command",
				finishRunCommand: "refarm agent finish --run --next-command",
				finishFixPlanCommand: "refarm agent finish --fix --next-command",
				finishFixRunCommand: "refarm agent finish --fix --run --next-command",
				finishPackagePlanCommand: "refarm agent finish --profile package --workspace <dir> --next-command",
				finishPackageRunCommand: "refarm agent finish --profile package --workspace <dir> --run --next-command",
				finishPackageFixRunCommand: "refarm agent finish --fix --profile package --workspace <dir> --run --next-command",
				finishAffectedPlanJsonCommand: "refarm agent finish --profile affected --json",
				finishAffectedRunJsonCommand: "refarm agent finish --profile affected --run --json",
				finishAffectedUpstreamRunJsonCommand: "refarm agent finish --profile affected --since upstream --run --json",
				finishAffectedSinceRunJsonCommand: "refarm agent finish --profile affected --since <ref> --run --json",
				finishAffectedTestRunJsonCommand: "refarm agent finish --profile affected --include-tests --run --json",
				finishAffectedRunCommand: "refarm agent finish --profile affected --run --next-command",
				finishAffectedUpstreamRunCommand: "refarm agent finish --profile affected --since upstream --run --next-command",
				finishAffectedSinceRunCommand: "refarm agent finish --profile affected --since <ref> --run --next-command",
				finishAffectedTestRunCommand: "refarm agent finish --profile affected --include-tests --run --next-command",
			},
			nextAction: "refarm check --next-action --json",
			nextCommand: "refarm check --next-command",
		});
		expect(payload.nextActions).toContain("refarm runtime status --json");
		expect(payload.nextActions).toContain("refarm runtime ensure --wait --next-command");
		expect(payload.nextActions).toContain("refarm package-manager --json");
		expect(payload.nextActions).toContain("refarm config profile coding --local --json");
		expect(payload.nextActions).toContain("refarm model providers --json");
		expect(payload.nextActions).toContain("refarm agent finish --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --fix --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --profile package --workspace <dir> --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --json");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --run --json");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --since upstream --run --json");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --since <ref> --run --json");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --run --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --since upstream --run --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --since <ref> --run --next-command");
		expect(payload.nextActions).toContain("refarm agent finish --profile affected --include-tests --run --next-command");
		expect(payload.nextCommands).toEqual([
			"refarm check --next-command",
			"refarm runtime ensure --wait --next-command",
			"refarm sow --model ollama/llama3.2 --json",
			"refarm sow --json",
			"refarm model current --json",
			"refarm package-manager --json",
			"refarm config profile coding --local --json",
			"refarm agent finish --next-command",
			"refarm agent finish --fix --next-command",
			"refarm agent finish --profile package --workspace <dir> --run --next-command",
			"refarm agent finish --profile affected --json",
			"refarm agent finish --profile affected --run --json",
			"refarm agent finish --profile affected --since upstream --run --json",
			"refarm agent finish --profile affected --since <ref> --run --json",
			"refarm agent finish --profile affected --run --next-command",
			"refarm agent finish --profile affected --since upstream --run --next-command",
			"refarm agent finish --profile affected --since <ref> --run --next-command",
			"refarm agent finish --profile affected --include-tests --run --next-command",
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

	it("prints the next fix finish command without executing it", async () => {
		const agentCommand = createAgentCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await agentCommand.parseAsync(["finish", "--fix", "--next-command"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith("refarm tidy imports --json");
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
			selection: { affectedWorkspaces?: string[]; includeTests: boolean; profile: string };
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
			selection: { affectedWorkspaces?: string[]; since: string | null; sinceRef: string | null };
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
			affectedWorkspaces: ["apps/refarm"],
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
			selection: { affectedWorkspaces?: string[]; since: string | null; sinceRef: string | null };
		};
		expect(payload.selection).toMatchObject({
			since: "upstream",
			sinceRef: "origin/main",
			affectedWorkspaces: ["apps/refarm"],
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
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "invalid-agent-finish-since-ref",
			nextCommand: "refarm agent finish --help",
		});
		expect(payload.message).toContain("Could not resolve upstream");
		expect(payload.message).toContain("--since <ref>");
		expect(payload.nextActions).toEqual([
			"Pass an explicit Git ref with `refarm agent finish --profile affected --since <ref> --json`.",
			"Configure the current branch upstream, then retry `refarm agent finish --profile affected --since upstream --json`.",
		]);
		logSpy.mockRestore();
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
			selection: { affectedWorkspaces?: string[]; includeTests: boolean };
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
			selection: { affectedWorkspaces?: string[] };
		};
		expect(payload.steps.map((step) => step.id)).toEqual([
			"tidy-imports-check",
			"health",
			"check",
		]);
		expect(payload.nextCommands).not.toContain("npm --prefix . run type-check");
		expect(payload.selection.affectedWorkspaces).toEqual([]);
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
			failedStepId: string | null;
			failedCommand: string | null;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			status: "passed",
			failedStepId: null,
			failedCommand: null,
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
		expect(logSpy).toHaveBeenCalledWith("Selection: quick");
		expect(logSpy).toHaveBeenCalledWith(
			"PASS tidy-imports-check: refarm tidy imports --check --json",
		);
		expect(logSpy).toHaveBeenCalledWith("Finish checks passed.");
		expect(runRefarm).toHaveBeenCalledTimes(3);
		logSpy.mockRestore();
	});

	it("prints remaining finish commands after a human failure report", async () => {
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

	it("prints selected affected workspaces in human finish reports", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-finish-human-"));
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
});
