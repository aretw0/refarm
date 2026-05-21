import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTuiCommand,
	resolveTuiLaunchSpec,
} from "../../src/commands/tui.js";

function makeStatus(overrides?: Partial<any>) {
	return {
		schemaVersion: 1 as const,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "tui",
		},
		renderer: {
			id: "refarm-tui",
			kind: "tui",
			capabilities: ["interactive", "diagnostics"],
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
		diagnostics: [],
		...overrides,
	};
}

describe("resolveTuiLaunchSpec", () => {
	it("maps watch and prompt launchers to deterministic commands", () => {
		expect(resolveTuiLaunchSpec("watch")).toEqual({
			command: "tractor",
			args: ["watch"],
			display: "tractor watch",
		});
		expect(resolveTuiLaunchSpec("prompt")).toEqual({
			command: "tractor",
			args: ["prompt"],
			display: "tractor prompt",
		});
	});
});

describe("tuiCommand", () => {
	const resolveStatusPayload = vi.fn();
	const printStatusSummary = vi.fn();
	const launch = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus(),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		launch.mockResolvedValue(0);
	});

	it("documents launch modes and runtime inspection in help", () => {
		let help = "";
		const command = createTuiCommand();
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		command.outputHelp();

		expect(help).toContain("refarm tui --launch --launcher prompt");
		expect(help).toContain("tractor watch or tractor prompt");
		expect(help).toContain("Use refarm runtime");
	});

	it("prints summary preflight by default", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		expect(resolveStatusPayload).toHaveBeenCalledWith(
			expect.objectContaining({ renderer: "tui" }),
		);
		expect(printStatusSummary).toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("available via --launch"),
		);
		logSpy.mockRestore();
	});

	it("outputs JSON with --json", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--json"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("schemaVersion"),
		);
		logSpy.mockRestore();
	});

	it("outputs selectable action rows with --actions", async () => {
		const shutdown = vi.fn().mockResolvedValue(undefined);
		resolveStatusPayload.mockResolvedValueOnce({
			json: makeStatus({
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
					],
				},
			}),
			shutdown,
		});
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions"], { from: "user" });

		expect(resolveStatusPayload).toHaveBeenCalledWith(
			expect.objectContaining({ renderer: "tui" }),
		);
		expect(logSpy).toHaveBeenCalledWith(
			"Available TUI actions:\n  [1] Open node — open-node (node:open)",
		);
		expect(printStatusSummary).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(shutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("outputs action rows as JSON with --actions --json", async () => {
		const shutdown = vi.fn().mockResolvedValue(undefined);
		resolveStatusPayload.mockResolvedValueOnce({
			json: makeStatus({
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
					],
				},
			}),
			shutdown,
		});
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions", "--json"], { from: "user" });

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			readiness: { status: "ready", label: "Ready: yes" },
			renderer: "tui",
			actionRows: [{ index: 1, id: "open-node", label: "Open node" }],
		});
		expect(output).not.toHaveProperty("selectedAction");
		expect(printStatusSummary).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(shutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("outputs a selected action row with --actions --select", async () => {
		const shutdown = vi.fn().mockResolvedValue(undefined);
		resolveStatusPayload.mockResolvedValueOnce({
			json: makeStatus({
				plugins: {
					installed: 2,
					active: 2,
					rejectedSurfaces: 0,
					surfaceActions: 2,
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
						{ id: "inspect-trust", label: "Inspect trust" },
					],
				},
			}),
			shutdown,
		});
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions", "--select", "2"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith(
			[
				"Selected TUI action:",
				"  [2] Inspect trust — inspect-trust",
				"Selection:",
				"  requested: 2",
				"  resolved: inspect-trust",
				"  source: index",
				"Available TUI actions:",
				"  [1] Open node — open-node (node:open)",
				"  [2] Inspect trust — inspect-trust",
			].join("\n"),
		);
		expect(printStatusSummary).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(shutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("outputs selected action envelopes with --actions --select --json", async () => {
		const shutdown = vi.fn().mockResolvedValue(undefined);
		resolveStatusPayload.mockResolvedValueOnce({
			json: makeStatus({
				plugins: {
					installed: 2,
					active: 2,
					rejectedSurfaces: 0,
					surfaceActions: 2,
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
						{ id: "inspect-trust", label: "Inspect trust" },
					],
				},
			}),
			shutdown,
		});
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions", "--select", "2", "--json"], {
			from: "user",
		});

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			readiness: { status: "ready", label: "Ready: yes" },
			renderer: "tui",
			selection: {
				requested: "2",
				source: "index",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selectedAction: { id: "inspect-trust", index: 2 },
		});
		expect(printStatusSummary).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(shutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("prints blocked TUI action JSON when the selected action is unavailable", async () => {
		const shutdown = vi.fn().mockResolvedValue(undefined);
		resolveStatusPayload.mockResolvedValueOnce({
			json: makeStatus({
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [{ id: "open-node", label: "Open node" }],
				},
			}),
			shutdown,
		});
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions", "--select", "missing", "--json"], {
			from: "user",
		});

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			reason: "dry-run",
			readiness: {
				status: "blocked",
				label: 'Blocked: host action "missing" is not available',
			},
			renderer: "tui",
			actionRows: [{ id: "open-node", index: 1 }],
		});
		expect(output).not.toHaveProperty("selection");
		expect(output).not.toHaveProperty("selectedAction");
		expect(printStatusSummary).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(shutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("rejects --actions --select in human output when the action is unavailable", async () => {
		resolveStatusPayload.mockResolvedValueOnce({
			json: makeStatus({
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [{ id: "open-node", label: "Open node" }],
				},
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--actions", "--select", "missing"], {
				from: "user",
			}),
		).rejects.toThrow(/Available selections: \[1\] open-node/);
		expect(launch).not.toHaveBeenCalled();
	});

	it("rejects --select without --actions", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--select", "open-node"], { from: "user" }),
		).rejects.toThrow(/--select requires --actions/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("rejects --actions with markdown or launch modes", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--actions", "--markdown"], { from: "user" }),
		).rejects.toThrow(/--actions cannot be combined/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("launches watch mode when --launch is requested", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch"], { from: "user" });

		expect(launch).toHaveBeenCalledWith(
			expect.objectContaining({
				display: "tractor watch",
			}),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Launching TUI runtime"),
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("REFARM"));
		logSpy.mockRestore();
	});

	it("launches prompt mode with --launcher prompt", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await command.parseAsync(["--launch", "--launcher", "prompt"], {
			from: "user",
		});

		expect(launch).toHaveBeenCalledWith(
			expect.objectContaining({
				display: "tractor prompt",
			}),
		);
	});

	it("rejects invalid launcher mode", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		command.exitOverride((error) => {
			throw error;
		});

		await expect(
			command.parseAsync(["--launch", "--launcher", "invalid"], {
				from: "user",
			}),
		).rejects.toThrow(/Invalid --launcher value/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
	});

	it("fails launch when runtime is not ready", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				runtime: { ready: false, namespace: "", databaseName: "" },
				diagnostics: ["runtime:not-ready"],
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--launch"], { from: "user" }),
		).rejects.toThrow(/runtime:not-ready/);
		expect(launch).not.toHaveBeenCalled();
	});

	it("fails launch when status has trust critical diagnostics", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				trust: { profile: "strict", warnings: 0, critical: 1 },
				diagnostics: ["trust:critical-present"],
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--launch"], { from: "user" }),
		).rejects.toThrow(/trust:critical-present/);
		expect(launch).not.toHaveBeenCalled();
	});

	it("rejects --json and --markdown together", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--json", "--markdown"], { from: "user" }),
		).rejects.toThrow(/Choose only one output format/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("rejects --launch with --json", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--launch", "--json"], { from: "user" }),
		).rejects.toThrow(/cannot be combined/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("rejects --dry-run without --launch", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--dry-run"], { from: "user" }),
		).rejects.toThrow(/requires --launch/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("prints dry-run command without launching process", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch", "--dry-run"], { from: "user" });

		expect(launch).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("[dry-run] would launch tui runtime"),
		);
		logSpy.mockRestore();
	});

	it("propagates launcher non-zero exit code", async () => {
		launch.mockResolvedValue(4);
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch"], { from: "user" });

		expect(process.exitCode).toBe(4);
		logSpy.mockRestore();
	});
});
