import type { StatusJson } from "@refarm.dev/cli/status";
import { accessSync, constants as fsConstants } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Task 3 connection-finding tests below resolve `/usr/bin/true` against the REAL
 * PATH (via `resolveBinary`, transitively through `buildConnectionDoctorRecommendations`)
 * to exercise a "this binary resolves fine" case — fail loudly up front rather than let
 * a missing binary make an unrelated assertion pass for the wrong reason, same doctrine
 * as `connection-status.test.ts`. */
function requireBinary(path: string): void {
	try {
		accessSync(path, fsConstants.X_OK);
	} catch {
		throw new Error(
			`${path} is required for this test but is not present/executable on this host`,
		);
	}
}
requireBinary("/usr/bin/true");

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
	createDoctorCommand,
	doctorCommand,
} from "../../src/commands/doctor.js";

function makeStatus(diagnostics: string[]): StatusJson {
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
			ready:
				!diagnostics.includes("runtime:not-ready") &&
				!diagnostics.includes("runtime:sidecar-access-blocked"),
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

		expect(report.command).toBe("doctor");
		expect(report.operation).toBe("diagnose");
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
			"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
			"Inspect trust warnings and decide whether they should block this workflow.",
		]);
		expect(report.nextAction).toBe(
			"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
		);
		expect(report.nextCommands).toEqual(["refarm runtime ensure --wait --next-command"]);
		expect(report.nextCommand).toBe("refarm runtime ensure --wait --next-command");
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

	// --- Task 3: a declared connection with an unresolvable binary or a catalog issue
	// becomes a doctor finding. `buildConnectionDoctorRecommendations` has its own
	// dedicated tests (connection-doctor.test.ts); these confirm it is actually WIRED
	// into `buildRefarmDoctorReport`'s warnings/recommendations/nextCommands, and stays
	// a `warning`, never a `failure`.

	it("folds a connection with a missing binary into warnings and recommendations", () => {
		const report = buildRefarmDoctorReport(makeStatus([]), {
			connectionConfig: {
				connections: {
					vpn: {
						establish: ["definitely-not-a-real-binary-xyz"],
						probe: { run: ["/usr/bin/true"] },
					},
				},
			},
		});

		expect(report.failureCount).toBe(0);
		expect(report.warningCount).toBe(1);
		expect(report.warnings).toEqual(["connection:binary-missing:vpn:establish"]);
		expect(report.recommendations).toContainEqual(
			expect.objectContaining({
				diagnostic: "connection:binary-missing:vpn:establish",
				severity: "warning",
				command: "refarm connection status --json",
			}),
		);
		// A missing connection binary must never gate `ok` by itself — only
		// `--fail-on-warnings` (a warning, never a failure) does that.
		expect(report.ok).toBe(true);
		expect(report.nextCommands).toContain("refarm connection status --json");
	});

	it("fails on a connection finding only when failOnWarnings is enabled", () => {
		const report = buildRefarmDoctorReport(makeStatus([]), {
			failOnWarnings: true,
			connectionConfig: {
				connections: {
					vpn: { establish: ["definitely-not-a-real-binary-xyz"], probe: { run: [] } },
				},
			},
		});
		expect(report.ok).toBe(false);
	});

	it("produces no connection findings when the catalog is empty (the default)", () => {
		const report = buildRefarmDoctorReport(makeStatus([]));
		expect(report.warningCount).toBe(0);
		expect(report.warnings).toEqual([]);
		expect(report.recommendations).toEqual([]);
	});

	it("adds a warning when REFARM_HOME and SILO_HOME point to different homes", () => {
		const report = buildRefarmDoctorReport(makeStatus([]), {
			context: {
				mode: "node",
				binding: { kind: "detached", origin: "explicit" },
				state: { policy: "node-owned", homeRef: "/tmp/refarm-home" },
				sovereignHome: "/tmp/refarm-home",
				credentialStoreHome: "/tmp/silo-home",
				homesAligned: false,
			},
		});

		expect(report.warningCount).toBe(1);
		expect(report.warnings).toContain("context:home-divergence");
		expect(report.recommendations).toContainEqual(
			expect.objectContaining({
				diagnostic: "context:home-divergence",
				severity: "warning",
				command: "refarm model current --json",
			}),
		);
		expect(report.nextCommands).toContain("refarm model current --json");
		expect(report.ok).toBe(true);
	});

	it("treats home divergence as blocking only when failOnWarnings is enabled", () => {
		const report = buildRefarmDoctorReport(makeStatus([]), {
			failOnWarnings: true,
			context: {
				mode: "node",
				binding: { kind: "detached", origin: "explicit" },
				state: { policy: "node-owned", homeRef: "/tmp/refarm-home" },
				sovereignHome: "/tmp/refarm-home",
				credentialStoreHome: "/tmp/silo-home",
				homesAligned: false,
			},
		});

		expect(report.ok).toBe(false);
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
				action: "Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
				command: "refarm runtime ensure --wait --next-command",
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

	it("does not recommend runtime ensure when local sidecar access is blocked", () => {
		expect(
			buildRefarmDoctorRecommendations({
				failures: ["runtime:sidecar-access-blocked"],
				warnings: [],
				informational: [],
			}),
		).toEqual([
			{
				diagnostic: "runtime:sidecar-access-blocked",
				severity: "failure",
				summary:
					"The runtime sidecar could not be reached from this execution surface.",
				action:
					"Run the runtime status probe from a direct shell or approved command surface with local sidecar network access.",
				command: "refarm runtime status --json",
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
		expect(help).toContain("refarm doctor --next-command");
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
		expect(String(output)).toContain('"nextCommands"');
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
			"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
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
				"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
			nextActions: [
				"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
				"Inspect trust warnings and decide whether they should block this workflow.",
			],
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: ["refarm runtime ensure --wait --next-command"],
			recommendations: [
				{
					diagnostic: "runtime:not-ready",
					severity: "failure",
					summary: "The runtime reported that it is not ready.",
					action:
						"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
					command: "refarm runtime ensure --wait --next-command",
				},
				{
					diagnostic: "trust:warnings-present",
					severity: "warning",
					summary: "Trust warnings are present.",
					action:
						"Inspect trust warnings and decide whether they should block this workflow.",
				},
			],
		});
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
	});

	it("emits only the first executable recovery command with --next-command", async () => {
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(["runtime:not-ready", "trust:warnings-present"]),
			shutdown: mockShutdown,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await doctorCommand.parseAsync(["--next-command"], { from: "user" });

		expect(logSpy).toHaveBeenCalledOnce();
		expect(logSpy).toHaveBeenCalledWith("refarm runtime ensure --wait --next-command");
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
	});

	it("emits the first executable recovery command as JSON", async () => {
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(["runtime:not-ready", "trust:warnings-present"]),
			shutdown: mockShutdown,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await doctorCommand.parseAsync(["--next-command", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			ok: false,
			nextAction:
				"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
			nextActions: [
				"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
				"Inspect trust warnings and decide whether they should block this workflow.",
			],
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: ["refarm runtime ensure --wait --next-command"],
			recommendations: [
				{
					diagnostic: "runtime:not-ready",
					severity: "failure",
					summary: "The runtime reported that it is not ready.",
					action:
						"Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`; use `refarm config set runtime.autostart always` if this should be automatic.",
					command: "refarm runtime ensure --wait --next-command",
				},
				{
					diagnostic: "trust:warnings-present",
					severity: "warning",
					summary: "Trust warnings are present.",
					action:
						"Inspect trust warnings and decide whether they should block this workflow.",
				},
			],
		});
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
	});

	// --- Task 3: `createDoctorCommand` accepts injected `loadConfig`/`cwd`, so the
	// wiring from "declared connection catalog" to "doctor JSON output" is exercised
	// WITHOUT ever touching the real `.refarm/config.json`.

	it("createDoctorCommand surfaces a connection finding via injected loadConfig, never touching the real config", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const loadConfigSpy = vi.fn().mockReturnValue({
			connections: {
				vpn: {
					establish: ["definitely-not-a-real-binary-xyz"],
					probe: { run: ["/usr/bin/true"] },
				},
			},
		});

		try {
			await createDoctorCommand({ loadConfig: loadConfigSpy, cwd: () => "/fake/root" }).parseAsync(
				["--json"],
				{ from: "user" },
			);

			expect(loadConfigSpy).toHaveBeenCalledWith("/fake/root");
			const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
			expect(output.warnings).toContain("connection:binary-missing:vpn:establish");
			expect(output.recommendations).toContainEqual(
				expect.objectContaining({
					diagnostic: "connection:binary-missing:vpn:establish",
					severity: "warning",
					command: "refarm connection status --json",
				}),
			);
			// A connection warning does not fail doctor by itself.
			expect(output.ok).toBe(true);
			expect(process.exitCode).toBeUndefined();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("createDoctorCommand reports no connection findings when loadConfig throws (report, never fail shut)", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await createDoctorCommand({
				loadConfig: () => {
					throw new Error("config is malformed");
				},
			}).parseAsync(["--json"], { from: "user" });

			const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
			expect(output.ok).toBe(true);
			expect(output.warnings).toEqual([]);
		} finally {
			logSpy.mockRestore();
		}
	});
});
