import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTuiCommand } from "../../src/commands/tui.js";

function makeStatus() {
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
	};
}

describe("tuiCommand", () => {
	const resolveStatusPayload = vi.fn();
	const printStatusSummary = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus(),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
	});

	it("prints summary preflight by default", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		expect(resolveStatusPayload).toHaveBeenCalledWith(
			expect.objectContaining({ renderer: "tui" }),
		);
		expect(printStatusSummary).toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("TUI launcher integration is pending"),
		);
		logSpy.mockRestore();
	});

	it("outputs JSON with --json", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--json"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("schemaVersion"),
		);
		logSpy.mockRestore();
	});

	it("rejects --json and --markdown together", async () => {
		const command = createTuiCommand({
			resolveStatusPayload,
			printStatusSummary,
		});

		await expect(
			command.parseAsync(["--json", "--markdown"], { from: "user" }),
		).rejects.toThrow(/Choose only one output format/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});
});
