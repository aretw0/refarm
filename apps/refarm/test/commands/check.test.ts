import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildRefarmCheckReport,
	createCheckCommand,
	type RefarmCheckDeps,
} from "../../src/commands/check.js";
import type { RefarmDoctorReport } from "../../src/commands/doctor.js";
import type { HealthReport } from "../../src/commands/health.js";
import type { ModelDoctorStatus } from "../../src/commands/model.js";

function makeHealthReport(overrides: Partial<HealthReport> = {}): HealthReport {
	return {
		command: "health",
		operation: "audit",
		ok: true,
		issueCount: 0,
		results: {
			git: [],
			builds: [],
			alignment: [],
		},
		resolution: [],
		recommendations: [],
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		...overrides,
		nextCommands: overrides.nextCommands ?? [],
	};
}

function makeDoctorReport(
	overrides: Partial<RefarmDoctorReport> = {},
): RefarmDoctorReport {
	return {
		command: "doctor",
		operation: "diagnose",
		ok: true,
		failureCount: 0,
		warningCount: 0,
		failures: [],
		warnings: [],
		informational: [],
		recommendations: [],
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			version: "0.1.0",
			packageManager: "pnpm",
		},
		status: {
			schemaVersion: 1,
			host: {
				app: "apps/refarm",
				command: "refarm",
				profile: "dev",
				mode: "headless",
			},
			renderer: {
				id: "refarm-headless",
				kind: "headless",
				capabilities: ["diagnostics"],
			},
			runtime: {
				ready: true,
				namespace: "refarm-main",
				databaseName: "refarm-main",
			},
			plugins: {
				installed: 0,
				active: 0,
				rejectedSurfaces: 0,
				surfaceActions: 0,
			},
			trust: {
				profile: "dev",
				warnings: 0,
				critical: 0,
			},
			streams: {
				active: 0,
				terminal: 0,
			},
			diagnostics: [],
		},
		...overrides,
	};
}

function makeModelDoctorStatus(
	overrides: Partial<ModelDoctorStatus> = {},
): ModelDoctorStatus {
	return {
		current: {
			provider: "openai",
			modelId: "gpt-5.5",
			ref: "openai/gpt-5.5",
		},
		providerProbe: {
			provider: "openai",
			baseUrl: undefined,
			url: undefined,
			ready: null,
			skipped: true,
		},
		handoffs: {
			inspectCurrent: "refarm model current --json",
			startOllama: "ollama serve",
			setDockerOllamaBaseUrl: "refarm model base-url http://host.docker.internal:11434 --json",
		},
		...overrides,
	};
}

function makeDeps(overrides: {
	health?: Partial<HealthReport>;
	doctor?: Partial<RefarmDoctorReport>;
	model?: Partial<ModelDoctorStatus>;
} = {}): RefarmCheckDeps {
	return {
		runHealth: vi.fn().mockResolvedValue(makeHealthReport(overrides.health)),
		runDoctor: vi.fn().mockResolvedValue(makeDoctorReport(overrides.doctor)),
		runModelDoctor: vi.fn().mockResolvedValue(makeModelDoctorStatus(overrides.model)),
	};
}

describe("buildRefarmCheckReport", () => {
	it("combines health and doctor readiness into one report", () => {
		const report = buildRefarmCheckReport({
			health: makeHealthReport({
				ok: false,
				issueCount: 2,
				recommendations: [
					{
						issueType: "missing-build-config",
						diagnostic: "missing-build-config",
						summary: "A package is missing a build config.",
						action: "Add the build config.",
						target: "packages/example",
					},
				],
			}),
			doctor: makeDoctorReport({
				ok: false,
				failureCount: 1,
				warningCount: 1,
				recommendations: [
					{
						diagnostic: "runtime:not-ready",
						severity: "failure",
						summary: "Runtime is not ready.",
						action: "Repair the runtime.",
						command: "refarm runtime start --wait",
					},
				],
			}),
			model: makeModelDoctorStatus(),
		});

		expect(report.command).toBe("check");
		expect(report.operation).toBe("readiness");
		expect(report.ok).toBe(false);
		expect(report.failureCount).toBe(3);
		expect(report.warningCount).toBe(1);
		expect(report.recommendations).toHaveLength(2);
		expect(report.nextAction).toBe("Add the build config.");
		expect(report.nextActions).toEqual([
			"Add the build config.",
			"Repair the runtime.",
		]);
		expect(report.nextCommand).toBe("refarm runtime start --wait");
		expect(report.nextCommands).toEqual(["refarm runtime start --wait"]);
		expect(report.checks.health.issueCount).toBe(2);
		expect(report.checks.doctor.failureCount).toBe(1);
	});
});

describe("checkCommand", () => {
	beforeEach(() => {
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it("documents the composite health and doctor gate in help", () => {
		const command = createCheckCommand(makeDeps());
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("refarm check --json");
		expect(help).toContain("refarm check --next-action");
		expect(help).toContain("refarm check --next-action --json");
		expect(help).toContain("refarm check --next-command");
		expect(help).toContain("combines refarm health and refarm doctor");
		expect(help).toContain("quick local confidence signal");
	});

	it("emits a machine-readable composite report", async () => {
		const deps = makeDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--json"], { from: "user" });

		expect(deps.runHealth).toHaveBeenCalledOnce();
		expect(deps.runDoctor).toHaveBeenCalledWith({ failOnWarnings: undefined });
		expect(deps.runModelDoctor).toHaveBeenCalledOnce();
		expect(process.exitCode).toBeUndefined();
		const output = String(logSpy.mock.calls[0]?.[0]);
		expect(output).toContain('"command": "check"');
		expect(output).toContain('"operation": "readiness"');
		expect(output).toContain('"ok": true');
		expect(output).toContain('"health"');
		expect(output).toContain('"doctor"');
		expect(output).toContain('"model"');
		expect(output).toContain('"nextAction": null');
		expect(output).toContain('"nextActions"');
		expect(output).toContain('"nextCommand": null');
		expect(output).toContain('"nextCommands"');
	});

	it("prints a failing summary and actionable recommendations", async () => {
		const deps = makeDeps({
			health: {
				ok: false,
				issueCount: 1,
				recommendations: [
					{
						issueType: "missing-build-config",
						diagnostic: "missing-build-config",
						summary: "A package is missing a build config.",
						action: "Add the build config.",
						target: "packages/example",
					},
				],
			},
			doctor: {
				recommendations: [
					{
						diagnostic: "renderer:non-interactive",
						severity: "info",
						summary: "Renderer is non-interactive.",
						action: "Use an interactive renderer when needed.",
					},
				],
			},
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Check: FAIL");
		expect(output).toContain("Health: fail (1 issue)");
		expect(output).toContain("Doctor: pass (0 failures, 0 warnings)");
		expect(output).toContain("Model: pass (0 warnings)");
		expect(output).toContain("missing-build-config");
		expect(output).not.toContain("renderer:non-interactive");
		expect(process.exitCode).toBe(1);
	});

	it("surfaces local model provider doctor failures as warnings", async () => {
		const deps = makeDeps({
			model: {
				current: {
					provider: "ollama",
					modelId: "llama3.2",
					ref: "ollama/llama3.2",
				},
				providerProbe: {
					provider: "ollama",
					baseUrl: "http://localhost:11434",
					url: "http://localhost:11434/api/tags",
					ready: false,
					error: "fetch failed: ECONNREFUSED",
				},
				recommendations: [
					{
						diagnostic: "model-provider-unreachable",
						severity: "failure",
						summary: "The current local model provider endpoint is not reachable from the runtime process.",
						action: "Start Ollama where Refarm can reach it, or set a base URL that matches the runtime network.",
						command: "refarm model doctor --json",
					},
				],
			},
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--json", "--next-action"], {
			from: "user",
		});

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			nextCommand: string;
			recommendations: Array<{ diagnostic: string; severity: string }>;
		};
		expect(output.ok).toBe(true);
		expect(output.nextCommand).toBe("refarm model doctor --json");
		expect(output.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "model-provider-unreachable",
				severity: "warning",
			}),
		]);
		expect(process.exitCode).toBeUndefined();

		logSpy.mockRestore();
	});

	it("prints only the first blocking recovery action with --next-action", async () => {
		const deps = makeDeps({
			health: {
				ok: false,
				issueCount: 1,
				recommendations: [
					{
						issueType: "missing-build-config",
						diagnostic: "missing-build-config",
						summary: "A package is missing a build config.",
						action: "Add the build config.",
						target: "packages/example",
					},
				],
			},
			doctor: {
				ok: false,
				failureCount: 1,
				recommendations: [
					{
						diagnostic: "runtime:not-ready",
						severity: "failure",
						summary: "Runtime is not ready.",
						action: "Repair the runtime.",
					},
				],
			},
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--next-action"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledOnce();
		expect(logSpy).toHaveBeenCalledWith("Add the build config.");
		expect(process.exitCode).toBe(1);
	});

	it("prints the next blocking recovery action as JSON", async () => {
		const deps = makeDeps({
			health: {
				ok: false,
				issueCount: 1,
				recommendations: [
					{
						issueType: "missing-build-config",
						diagnostic: "missing-build-config",
						summary: "A package is missing a build config.",
						action: "Add the build config.",
						target: "packages/example",
					},
				],
			},
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--json", "--next-action"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledOnce();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			ok: false,
			nextAction: "Add the build config.",
			nextActions: ["Add the build config."],
			nextCommand: null,
			nextCommands: [],
			recommendations: [
				{
					issueType: "missing-build-config",
					diagnostic: "missing-build-config",
					summary: "A package is missing a build config.",
					action: "Add the build config.",
					target: "packages/example",
				},
			],
		});
		expect(process.exitCode).toBe(1);
	});

	it("compacts repeated recommendations in next-action JSON", async () => {
		const deps = makeDeps({
			health: {
				ok: false,
				issueCount: 2,
				recommendations: [
					{
						issueType: "git_ignored",
						diagnostic: "git_ignored",
						summary: "docs/_site/a.md is ignored by Git.",
						action: "Track the source file, or add an explicit health policy exclusion if it is generated.",
						command: "refarm health --suggest-policy --json",
						target: "docs/_site/a.md",
					},
					{
						issueType: "git_ignored",
						diagnostic: "git_ignored",
						summary: "docs/_site/b.md is ignored by Git.",
						action: "Track the source file, or add an explicit health policy exclusion if it is generated.",
						command: "refarm health --suggest-policy --json",
						target: "docs/_site/b.md",
					},
				],
			},
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--json", "--next-action"], {
			from: "user",
		});

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output.recommendations).toEqual([
			{
				issueType: "git_ignored",
				diagnostic: "git_ignored",
				summary: "docs/_site/a.md is ignored by Git.",
				action: "Track the source file, or add an explicit health policy exclusion if it is generated.",
				command: "refarm health --suggest-policy --json",
				target: "docs/_site/a.md",
			},
		]);
		expect(output.nextCommand).toBe("refarm health --suggest-policy --json");
		expect(process.exitCode).toBe(1);
	});

	it("prints only the first executable recovery command with --next-command", async () => {
		const deps = makeDeps({
			doctor: {
				ok: false,
				failureCount: 1,
				recommendations: [
					{
						diagnostic: "runtime:not-ready",
						severity: "failure",
						summary: "Runtime is not ready.",
						action: "Repair the runtime.",
						command: "refarm runtime start --wait",
					},
				],
			},
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--next-command"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledOnce();
		expect(logSpy).toHaveBeenCalledWith("refarm runtime start --wait");
		expect(process.exitCode).toBe(1);
	});

	it("prints the next executable recovery command as JSON", async () => {
		const deps = makeDeps({
			doctor: {
				ok: false,
				failureCount: 1,
				recommendations: [
					{
						diagnostic: "runtime:not-ready",
						severity: "failure",
						summary: "Runtime is not ready.",
						action: "Repair the runtime.",
						command: "refarm runtime start --wait",
					},
				],
			},
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--json", "--next-command"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledOnce();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			ok: false,
			nextAction: "Repair the runtime.",
			nextActions: ["Repair the runtime."],
			nextCommand: "refarm runtime start --wait",
			nextCommands: ["refarm runtime start --wait"],
			recommendations: [
				{
					diagnostic: "runtime:not-ready",
					severity: "failure",
					summary: "Runtime is not ready.",
					action: "Repair the runtime.",
					command: "refarm runtime start --wait",
				},
			],
		});
		expect(process.exitCode).toBe(1);
	});

	it("passes fail-on-warnings through to the doctor gate", async () => {
		const deps = makeDeps({
			doctor: {
				ok: false,
				warningCount: 1,
				warnings: ["trust:warnings-present"],
			},
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--fail-on-warnings"], {
			from: "user",
		});

		expect(deps.runDoctor).toHaveBeenCalledWith({ failOnWarnings: true });
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
	});
});
