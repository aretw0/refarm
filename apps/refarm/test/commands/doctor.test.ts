import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveStatusPayload, mockShutdown } = vi.hoisted(() => ({
	mockResolveStatusPayload: vi.fn(),
	mockShutdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/commands/status.js", () => ({
	resolveStatusPayload: mockResolveStatusPayload,
}));

import {
	buildRefarmDoctorRecommendations,
	buildRefarmDoctorReport,
	doctorCommand,
} from "../../src/commands/doctor.js";

function makeStatus(diagnostics: string[]): RefarmStatusJson {
	return {
		schemaVersion: 1 as const,
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
			ready: !diagnostics.includes("runtime:not-ready"),
			namespace: "refarm-main",
			databaseName: "refarm-main",
			engine: {
				configuredEngine: "auto",
				activeEngine: "rust",
			},
		},
		plugins: {
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		},
		trust: {
			profile: "dev",
			warnings: diagnostics.includes("trust:warnings-present") ? 1 : 0,
			critical: diagnostics.includes("trust:critical-present") ? 1 : 0,
		},
		streams: { active: 0, terminal: 0 },
		diagnostics,
	};
}

describe("buildRefarmDoctorReport", () => {
	it("classifies failures, warnings and informational diagnostics", () => {
		const report = buildRefarmDoctorReport(
			makeStatus([
				"runtime:not-ready",
				"trust:warnings-present",
				"renderer:non-interactive",
			]),
			{
				metadata: {
					app: "apps/refarm",
					command: "refarm",
					profile: "dev",
					version: "1.2.3",
					packageManager: "pnpm",
				},
			},
		);

		expect(report.ok).toBe(false);
		expect(report.failures).toEqual(["runtime:not-ready"]);
		expect(report.warnings).toEqual(["trust:warnings-present"]);
		expect(report.informational).toEqual(["renderer:non-interactive"]);
		expect(report.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "runtime:not-ready",
				severity: "failure",
			}),
			expect.objectContaining({
				diagnostic: "trust:warnings-present",
				severity: "warning",
			}),
			expect.objectContaining({
				diagnostic: "renderer:non-interactive",
				severity: "info",
			}),
		]);
		expect(report.nextActions).toEqual([
			"Run `refarm runtime status`, then `refarm runtime start --wait`; use `refarm config set runtime.autostart always` if this should be automatic.",
			"Inspect trust warnings and decide whether they should block this workflow.",
		]);
		expect(report.host.version).toBe("1.2.3");
		expect(report.host.packageManager).toBe("pnpm");
	});

	it("fails on warnings when failOnWarnings is enabled", () => {
		const report = buildRefarmDoctorReport(
			makeStatus(["trust:warnings-present"]),
			{ failOnWarnings: true },
		);
		expect(report.ok).toBe(false);
		expect(report.failureCount).toBe(0);
		expect(report.warningCount).toBe(1);
	});
});

describe("buildRefarmDoctorRecommendations", () => {
	it("creates stable recommendations for status diagnostics", () => {
		expect(
			buildRefarmDoctorRecommendations({
				failures: ["runtime:not-ready"],
				warnings: ["plugins:rejected-surfaces-present"],
				informational: ["renderer:no-rich-html"],
			}),
		).toEqual([
			{
				diagnostic: "runtime:not-ready",
				severity: "failure",
				summary: "The runtime reported that it is not ready.",
				action: "Run `refarm runtime status`, then `refarm runtime start --wait`; use `refarm config set runtime.autostart always` if this should be automatic.",
			},
			{
				diagnostic: "plugins:rejected-surfaces-present",
				severity: "warning",
				summary: "One or more plugin surfaces were rejected.",
				action: "Inspect plugin manifests and host surface policy before exposing plugin UI.",
			},
			{
				diagnostic: "renderer:no-rich-html",
				severity: "info",
				summary: "The selected renderer does not support rich HTML.",
				action: "Use a renderer with rich HTML support when plugin surfaces require it.",
			},
		]);
	});
});

describe("doctorCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(["renderer:non-interactive"]),
			shutdown: mockShutdown,
		});
	});

	it("documents doctor output modes and check handoff in help", () => {
		let help = "";
		doctorCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		doctorCommand.outputHelp();

		expect(help).toContain("refarm doctor --json");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm doctor --next-action --json");
		expect(help).toContain("refarm doctor --input status.json");
		expect(help).toContain("Use refarm check");
	});

	it("prints PASS for informational diagnostics only", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await doctorCommand.parseAsync([], { from: "user" });

		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith("Doctor: PASS");
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Host:"));
		expect(logSpy).toHaveBeenCalledWith(
			"Runtime: ready (engine=rust, configured=auto)",
		);
		expect(mockShutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("sets exit code when failure diagnostics are present", async () => {
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(["runtime:not-ready"]),
			shutdown: mockShutdown,
		});

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await doctorCommand.parseAsync([], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(logSpy).toHaveBeenCalledWith("Doctor: FAIL");
		logSpy.mockRestore();
	});

	it("sets exit code when fail-on-warnings is enabled", async () => {
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(["trust:warnings-present"]),
			shutdown: mockShutdown,
		});

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await doctorCommand.parseAsync(["--fail-on-warnings"], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(logSpy).toHaveBeenCalledWith("Doctor: FAIL");
		logSpy.mockRestore();
	});

	it("emits machine-readable report with --json", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await doctorCommand.parseAsync(["--json"], { from: "user" });

		const output = logSpy.mock.calls[0]?.[0];
		expect(typeof output).toBe("string");
		expect(String(output)).toContain('"ok": true');
		expect(String(output)).toContain('"host"');
		expect(String(output)).toContain('"status"');
		expect(String(output)).toContain('"recommendations"');
		expect(String(output)).toContain('"nextActions"');
		logSpy.mockRestore();
	});

	it("emits only the first blocking recovery action with --next-action", async () => {
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(["runtime:not-ready", "trust:warnings-present"]),
			shutdown: mockShutdown,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await doctorCommand.parseAsync(["--next-action"], { from: "user" });

		expect(logSpy).toHaveBeenCalledOnce();
		expect(logSpy).toHaveBeenCalledWith(
			"Run `refarm runtime status`, then `refarm runtime start --wait`; use `refarm config set runtime.autostart always` if this should be automatic.",
		);
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
	});

	it("emits the first blocking recovery action as JSON", async () => {
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(["runtime:not-ready", "trust:warnings-present"]),
			shutdown: mockShutdown,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await doctorCommand.parseAsync(["--next-action", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			ok: false,
			nextAction:
				"Run `refarm runtime status`, then `refarm runtime start --wait`; use `refarm config set runtime.autostart always` if this should be automatic.",
			nextActions: [
				"Run `refarm runtime status`, then `refarm runtime start --wait`; use `refarm config set runtime.autostart always` if this should be automatic.",
				"Inspect trust warnings and decide whether they should block this workflow.",
			],
		});
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
	});
});
