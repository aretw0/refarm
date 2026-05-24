import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildRefarmCheckReport,
	createCheckCommand,
	type RefarmCheckDeps,
} from "../../src/commands/check.js";
import type { RefarmDoctorReport } from "../../src/commands/doctor.js";
import type { HealthReport } from "../../src/commands/health.js";

function makeHealthReport(overrides: Partial<HealthReport> = {}): HealthReport {
	return {
		ok: true,
		issueCount: 0,
		results: {
			git: [],
			builds: [],
			alignment: [],
		},
		resolution: [],
		recommendations: [],
		nextActions: [],
		...overrides,
	};
}

function makeDoctorReport(
	overrides: Partial<RefarmDoctorReport> = {},
): RefarmDoctorReport {
	return {
		ok: true,
		failureCount: 0,
		warningCount: 0,
		failures: [],
		warnings: [],
		informational: [],
		recommendations: [],
		nextActions: [],
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

function makeDeps(overrides: {
	health?: Partial<HealthReport>;
	doctor?: Partial<RefarmDoctorReport>;
} = {}): RefarmCheckDeps {
	return {
		runHealth: vi.fn().mockResolvedValue(makeHealthReport(overrides.health)),
		runDoctor: vi.fn().mockResolvedValue(makeDoctorReport(overrides.doctor)),
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
					},
				],
			}),
		});

		expect(report.ok).toBe(false);
		expect(report.failureCount).toBe(3);
		expect(report.warningCount).toBe(1);
		expect(report.recommendations).toHaveLength(2);
		expect(report.nextAction).toBe("Add the build config.");
		expect(report.nextActions).toEqual([
			"Add the build config.",
			"Repair the runtime.",
		]);
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
		expect(help).toContain("combines refarm health and refarm doctor");
		expect(help).toContain("quick local confidence signal");
	});

	it("emits a machine-readable composite report", async () => {
		const deps = makeDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createCheckCommand(deps).parseAsync(["--json"], { from: "user" });

		expect(deps.runHealth).toHaveBeenCalledOnce();
		expect(deps.runDoctor).toHaveBeenCalledWith({ failOnWarnings: undefined });
		expect(process.exitCode).toBeUndefined();
		const output = String(logSpy.mock.calls[0]?.[0]);
		expect(output).toContain('"ok": true');
		expect(output).toContain('"health"');
		expect(output).toContain('"doctor"');
		expect(output).toContain('"nextAction": null');
		expect(output).toContain('"nextActions"');
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
		expect(output).toContain("missing-build-config");
		expect(output).not.toContain("renderer:non-interactive");
		expect(process.exitCode).toBe(1);
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
