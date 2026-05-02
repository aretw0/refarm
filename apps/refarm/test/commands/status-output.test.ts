import { describe, expect, it, vi } from "vitest";
import {
	emitRefarmStatusOutput,
	resolveStatusOutputMode,
} from "../../src/commands/status-output.js";

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

describe("resolveStatusOutputMode", () => {
	it("resolves explicit modes and falls back to default", () => {
		expect(
			resolveStatusOutputMode(
				{ json: true },
				{ defaultMode: "summary", errorMessage: "err" },
			),
		).toBe("json");
		expect(
			resolveStatusOutputMode(
				{ markdown: true },
				{ defaultMode: "summary", errorMessage: "err" },
			),
		).toBe("markdown");
		expect(
			resolveStatusOutputMode(
				{ summary: true },
				{ defaultMode: "json", errorMessage: "err" },
			),
		).toBe("summary");
		expect(
			resolveStatusOutputMode({}, { defaultMode: "json", errorMessage: "err" }),
		).toBe("json");
	});

	it("rejects conflicting modes", () => {
		expect(() =>
			resolveStatusOutputMode(
				{ json: true, markdown: true },
				{ defaultMode: "summary", errorMessage: "Choose one." },
			),
		).toThrow(/Choose one/);
	});
});

describe("emitRefarmStatusOutput", () => {
	it("emits json, markdown, or summary output based on mode", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const printSummary = vi.fn();
		const status = makeStatus();

		emitRefarmStatusOutput({ status, mode: "json", printSummary });
		emitRefarmStatusOutput({ status, mode: "markdown", printSummary });
		emitRefarmStatusOutput({ status, mode: "summary", printSummary });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("schemaVersion"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("# Refarm Status"),
		);
		expect(printSummary).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 1 }),
		);
		logSpy.mockRestore();
	});
});
