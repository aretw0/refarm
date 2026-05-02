import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveStatusPayload, mockShutdown } = vi.hoisted(() => ({
	mockResolveStatusPayload: vi.fn(),
	mockShutdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/commands/status.js", () => ({
	resolveStatusPayload: mockResolveStatusPayload,
}));

import {
	buildRefarmDoctorReport,
	doctorCommand,
} from "../../src/commands/doctor.js";

function makeStatus(diagnostics: string[]) {
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
				},
			},
		);

		expect(report.ok).toBe(false);
		expect(report.failures).toEqual(["runtime:not-ready"]);
		expect(report.warnings).toEqual(["trust:warnings-present"]);
		expect(report.informational).toEqual(["renderer:non-interactive"]);
		expect(report.host.version).toBe("1.2.3");
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

describe("doctorCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(["renderer:non-interactive"]),
			shutdown: mockShutdown,
		});
	});

	it("prints PASS for informational diagnostics only", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await doctorCommand.parseAsync([], { from: "user" });

		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith("Doctor: PASS");
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Host:"));
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
		logSpy.mockRestore();
	});
});
