import { describe, expect, it, vi } from "vitest";
import { runStatusPreflight } from "../../src/commands/status-preflight.js";

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

describe("runStatusPreflight", () => {
	it("emits output, calls afterEmit, and closes shutdown", async () => {
		const status = makeStatus();
		const shutdown = vi.fn().mockResolvedValue(undefined);
		const resolveStatusPayload = vi.fn().mockResolvedValue({
			json: status,
			shutdown,
		});
		const printSummary = vi.fn();
		const afterEmit = vi.fn();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await runStatusPreflight({
			resolveStatusPayload,
			resolveOptions: { renderer: "headless" },
			outputMode: "json",
			printSummary,
			afterEmit,
		});

		expect(result).toBe(status);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("schemaVersion"),
		);
		expect(printSummary).not.toHaveBeenCalled();
		expect(afterEmit).toHaveBeenCalledWith(status);
		expect(shutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("delegates summary mode to printSummary", async () => {
		const status = makeStatus();
		const shutdown = vi.fn().mockResolvedValue(undefined);
		const resolveStatusPayload = vi.fn().mockResolvedValue({
			json: status,
			shutdown,
		});
		const printSummary = vi.fn();

		await runStatusPreflight({
			resolveStatusPayload,
			resolveOptions: { renderer: "headless" },
			outputMode: "summary",
			printSummary,
		});

		expect(printSummary).toHaveBeenCalledWith(status);
		expect(shutdown).toHaveBeenCalled();
	});

	it("still closes shutdown when afterEmit throws", async () => {
		const shutdown = vi.fn().mockResolvedValue(undefined);
		const resolveStatusPayload = vi.fn().mockResolvedValue({
			json: makeStatus(),
			shutdown,
		});

		await expect(
			runStatusPreflight({
				resolveStatusPayload,
				resolveOptions: { renderer: "headless" },
				outputMode: "summary",
				printSummary: vi.fn(),
				afterEmit: () => {
					throw new Error("afterEmit boom");
				},
			}),
		).rejects.toThrow(/afterEmit boom/);

		expect(shutdown).toHaveBeenCalled();
	});
});
