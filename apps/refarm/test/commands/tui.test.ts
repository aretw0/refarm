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
			command: "cargo",
			args: ["run", "-p", "tractor", "--", "watch"],
			display: "cargo run -p tractor -- watch",
		});
		expect(resolveTuiLaunchSpec("prompt")).toEqual({
			command: "cargo",
			args: ["run", "-p", "tractor", "--", "prompt"],
			display: "cargo run -p tractor -- prompt",
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
				display: "cargo run -p tractor -- watch",
			}),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Launching TUI runtime"),
		);
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
				display: "cargo run -p tractor -- prompt",
			}),
		);
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
