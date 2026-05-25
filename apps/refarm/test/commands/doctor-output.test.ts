import { describe, expect, it, vi } from "vitest";
import {
	emitRefarmDoctorOutput,
	formatRefarmDoctorNextActionJson,
	formatRefarmDoctorReportJson,
	printRefarmDoctorNextAction,
	printRefarmDoctorNextCommand,
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
		nextCommands: [] as string[],
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
	});

	it("maps --next-action --json to next-action-json mode", () => {
		expect(resolveDoctorOutputMode({ json: true, nextAction: true })).toBe(
			"next-action-json",
		);
	});

	it("maps --next-command to next-command modes", () => {
		expect(resolveDoctorOutputMode({ nextCommand: true })).toBe("next-command");
		expect(resolveDoctorOutputMode({ json: true, nextCommand: true })).toBe(
			"next-command-json",
		);
		expect(
			resolveDoctorOutputMode({
				json: true,
				nextAction: true,
				nextCommand: true,
			}),
		).toBe("next-command-json");
	});
});

describe("formatRefarmDoctorReportJson", () => {
	it("includes host and status fields", () => {
		const output = formatRefarmDoctorReportJson(makeReport());
		expect(output).toContain('"host"');
		expect(output).toContain('"status"');
		expect(output).toContain('"recommendations"');
		expect(output).toContain('"nextActions"');
		expect(output).toContain('"nextCommands"');
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
				nextCommands: ["refarm runtime start --wait"],
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

describe("printRefarmDoctorNextCommand", () => {
	it("prints only the first next command", () => {
		const log = vi.fn();
		printRefarmDoctorNextCommand(
			{
				...makeReport(),
				nextActions: ["Start runtime."],
				nextCommands: ["refarm runtime start --wait", "refarm doctor"],
			},
			log,
		);

		expect(log).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith("refarm runtime start --wait");
	});

	it("prints nothing when no next command is available", () => {
		const log = vi.fn();
		printRefarmDoctorNextCommand(makeReport(), log);

		expect(log).not.toHaveBeenCalled();
	});
});

describe("formatRefarmDoctorNextActionJson", () => {
	it("formats next-action payload for automation", () => {
		expect(
			JSON.parse(
				formatRefarmDoctorNextActionJson({
					...makeReport(),
					ok: false,
					nextActions: ["Start runtime.", "Inspect trust."],
					nextCommands: ["refarm runtime start --wait"],
				}),
			),
		).toEqual({
			ok: false,
			nextAction: "Start runtime.",
			nextActions: ["Start runtime.", "Inspect trust."],
			nextCommand: "refarm runtime start --wait",
			nextCommands: ["refarm runtime start --wait"],
			recommendations: [],
		});
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
				nextCommands: ["refarm runtime start --wait"],
			},
			mode: "next-action",
			log,
		});

		expect(log).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith("Start runtime.");
	});

	it("emits next action JSON in next-action-json mode", () => {
		const log = vi.fn();
		emitRefarmDoctorOutput({
			report: {
				...makeReport(),
				ok: false,
				nextActions: ["Start runtime."],
				nextCommands: ["refarm runtime start --wait"],
			},
			mode: "next-action-json",
			log,
		});

		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
			ok: false,
			nextAction: "Start runtime.",
			nextActions: ["Start runtime."],
			nextCommand: "refarm runtime start --wait",
			nextCommands: ["refarm runtime start --wait"],
			recommendations: [],
		});
	});

	it("emits only the next command in next-command mode", () => {
		const log = vi.fn();
		emitRefarmDoctorOutput({
			report: {
				...makeReport(),
				nextActions: ["Start runtime."],
				nextCommands: ["refarm runtime start --wait"],
			},
			mode: "next-command",
			log,
		});

		expect(log).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith("refarm runtime start --wait");
	});

	it("emits next command JSON in next-command-json mode", () => {
		const log = vi.fn();
		emitRefarmDoctorOutput({
			report: {
				...makeReport(),
				ok: false,
				nextActions: ["Start runtime."],
				nextCommands: ["refarm runtime start --wait"],
			},
			mode: "next-command-json",
			log,
		});

		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
			ok: false,
			nextAction: "Start runtime.",
			nextActions: ["Start runtime."],
			nextCommand: "refarm runtime start --wait",
			nextCommands: ["refarm runtime start --wait"],
			recommendations: [],
		});
	});
});
