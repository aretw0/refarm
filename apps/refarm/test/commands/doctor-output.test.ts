import { describe, expect, it, vi } from "vitest";
import {
	emitRefarmDoctorOutput,
	formatRefarmDoctorReportJson,
	printRefarmDoctorReport,
	resolveDoctorOutputMode,
} from "../../src/commands/doctor-output.js";

function makeReport() {
	return {
		ok: true,
		failureCount: 0,
		warningCount: 0,
		failures: [] as string[],
		warnings: [] as string[],
		informational: ["renderer:non-interactive"],
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			version: "1.2.3",
		},
		status: {
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
			streams: { active: 0, terminal: 0 },
			diagnostics: ["renderer:non-interactive"],
		},
	};
}

describe("resolveDoctorOutputMode", () => {
	it("maps --json to json mode and defaults to summary", () => {
		expect(resolveDoctorOutputMode({ json: true })).toBe("json");
		expect(resolveDoctorOutputMode({})).toBe("summary");
	});
});

describe("formatRefarmDoctorReportJson", () => {
	it("includes host and status fields", () => {
		const output = formatRefarmDoctorReportJson(makeReport());
		expect(output).toContain('"host"');
		expect(output).toContain('"status"');
		expect(output).toContain('"version": "1.2.3"');
	});
});

describe("printRefarmDoctorReport", () => {
	it("prints report sections with host line", () => {
		const log = vi.fn();
		printRefarmDoctorReport(makeReport(), log);
		expect(log).toHaveBeenCalledWith("Doctor: PASS");
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("Host: refarm v1.2.3"),
		);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Renderer:"));
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Runtime:"));
		expect(log).toHaveBeenCalledWith("Info:");
	});
});

describe("emitRefarmDoctorOutput", () => {
	it("emits json or summary based on mode", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const report = makeReport();
		emitRefarmDoctorOutput({ report, mode: "json" });
		emitRefarmDoctorOutput({ report, mode: "summary" });
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"ok": true'));
		expect(logSpy).toHaveBeenCalledWith("Doctor: PASS");
		logSpy.mockRestore();
	});
});
