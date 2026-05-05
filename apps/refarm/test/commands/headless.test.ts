import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveStatusPayload, mockShutdown, mockPrintStatusSummary } =
	vi.hoisted(() => ({
		mockResolveStatusPayload: vi.fn(),
		mockShutdown: vi.fn().mockResolvedValue(undefined),
		mockPrintStatusSummary: vi.fn(),
	}));

vi.mock("../../src/commands/status.js", () => ({
	resolveStatusPayload: mockResolveStatusPayload,
	printStatusSummary: mockPrintStatusSummary,
}));

import { headlessCommand } from "../../src/commands/headless.js";

function makeStatus() {
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

describe("headlessCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(),
			shutdown: mockShutdown,
		});
	});

	it("outputs JSON by default", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync([], { from: "user" });

		expect(mockResolveStatusPayload).toHaveBeenCalledWith(
			expect.objectContaining({ renderer: "headless" }),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("schemaVersion"),
		);
		expect(mockShutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("outputs markdown with --markdown", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync(["--markdown"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("# Refarm Status"),
		);
		logSpy.mockRestore();
	});

	it("delegates summary formatting with --summary", async () => {
		await headlessCommand.parseAsync(["--summary"], { from: "user" });
		expect(mockPrintStatusSummary).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 1 }),
		);
	});

	it("rejects --markdown and --summary together", async () => {
		await expect(
			headlessCommand.parseAsync(["--markdown", "--summary"], {
				from: "user",
			}),
		).rejects.toThrow(/Choose only one output format/);
		expect(mockResolveStatusPayload).not.toHaveBeenCalled();
	});
});
