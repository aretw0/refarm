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

import { webCommand } from "../../src/commands/web.js";

function makeStatus() {
	return {
		schemaVersion: 1 as const,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "web",
		},
		renderer: {
			id: "refarm-web",
			kind: "web",
			capabilities: ["interactive", "rich-html", "diagnostics"],
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

describe("webCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(),
			shutdown: mockShutdown,
		});
	});

	it("uses web renderer posture by default", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await webCommand.parseAsync([], { from: "user" });

		expect(mockResolveStatusPayload).toHaveBeenCalledWith(
			expect.objectContaining({ renderer: "web" }),
		);
		expect(mockPrintStatusSummary).toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Web launcher integration is pending"),
		);
		expect(mockShutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("outputs JSON with --json", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await webCommand.parseAsync(["--json"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("schemaVersion"),
		);
		logSpy.mockRestore();
	});

	it("outputs markdown with --markdown", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await webCommand.parseAsync(["--markdown"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("# Refarm Status"),
		);
		logSpy.mockRestore();
	});

	it("rejects --json and --markdown together", async () => {
		await expect(
			webCommand.parseAsync(["--json", "--markdown"], {
				from: "user",
			}),
		).rejects.toThrow(/Choose only one output format/);
		expect(mockResolveStatusPayload).not.toHaveBeenCalled();
	});
});
