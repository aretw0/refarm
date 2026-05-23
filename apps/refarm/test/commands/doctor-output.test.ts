import { describe, expect, it, vi } from "vitest";
import {
	emitRefarmDoctorOutput,
	formatRefarmDoctorReportJson,
	printRefarmDoctorNextAction,
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
		recommendations: [
			{
				diagnostic: "renderer:non-interactive",
				severity: "info" as const,
				summary: "The selected renderer is non-interactive.",
				action: "Use a web or TUI renderer when the workflow requires interactive controls.",
			},
		],
		nextActions: [] as string[],
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			version: "1.2.3",
			packageManager: "pnpm" as const,
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

	it("maps --next-action to next-action mode", () => {
		expect(resolveDoctorOutputMode({ nextAction: true })).toBe("next-action");
		expect(resolveDoctorOutputMode({ json: true, nextAction: true })).toBe(
			"next-action",
		);
	});
});

describe("formatRefarmDoctorReportJson", () => {
	it("includes host and status fields", () => {
		const output = formatRefarmDoctorReportJson(makeReport());
		expect(output).toContain('"host"');
		expect(output).toContain('"status"');
		expect(output).toContain('"recommendations"');
		expect(output).toContain('"nextActions"');
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
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("packageManager=pnpm"),
		);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Renderer:"));
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Runtime:"));
		expect(log).toHaveBeenCalledWith("Info:");
	});

	it("prints recommendations for failures and warnings", () => {
		const log = vi.fn();
		const report = {
			...makeReport(),
			ok: false,
			failureCount: 1,
			warningCount: 1,
			failures: ["runtime:not-ready"],
			warnings: ["trust:warnings-present"],
			recommendations: [
				{
					diagnostic: "runtime:not-ready",
					severity: "failure" as const,
					summary: "The runtime reported that it is not ready.",
					action: "Run `refarm runtime status`, then `refarm runtime start --wait`; use `refarm config set runtime.autostart always` if this should be automatic.",
				},
				{
					diagnostic: "trust:warnings-present",
					severity: "warning" as const,
					summary: "Trust warnings are present.",
					action: "Inspect trust warnings and decide whether they should block this workflow.",
				},
				{
					diagnostic: "renderer:non-interactive",
					severity: "info" as const,
					summary: "The selected renderer is non-interactive.",
					action: "Use a web or TUI renderer when the workflow requires interactive controls.",
				},
			],
			nextActions: [
				"Run `refarm runtime status`, then `refarm runtime start --wait`; use `refarm config set runtime.autostart always` if this should be automatic.",
				"Inspect trust warnings and decide whether they should block this workflow.",
			],
		};

		printRefarmDoctorReport(report, log);

		expect(log).toHaveBeenCalledWith("Recommendations:");
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("runtime:not-ready"),
		);
		const recommendationStart = log.mock.calls.findIndex(
			([message]) => message === "Recommendations:",
		);
		const recommendationLines = log.mock.calls
			.slice(recommendationStart)
			.map(([message]) => String(message));
		expect(recommendationLines.join("\n")).not.toContain(
			"renderer:non-interactive",
		);
	});
});

describe("printRefarmDoctorNextAction", () => {
	it("prints only the first next action", () => {
		const log = vi.fn();
		printRefarmDoctorNextAction(
			{
				...makeReport(),
				nextActions: ["Start runtime.", "Inspect trust."],
			},
			log,
		);

		expect(log).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith("Start runtime.");
	});

	it("prints nothing when no next action is available", () => {
		const log = vi.fn();
		printRefarmDoctorNextAction(makeReport(), log);

		expect(log).not.toHaveBeenCalled();
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

	it("emits only the next action in next-action mode", () => {
		const log = vi.fn();
		emitRefarmDoctorOutput({
			report: {
				...makeReport(),
				nextActions: ["Start runtime."],
			},
			mode: "next-action",
			log,
		});

		expect(log).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith("Start runtime.");
	});
});
