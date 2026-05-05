import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelemetryDeps } from "../../src/commands/telemetry.js";
import { createTelemetryCommand } from "../../src/commands/telemetry.js";

function makeDeps(overrides: Partial<TelemetryDeps> = {}): TelemetryDeps {
	return {
		fetchTelemetry: vi.fn().mockResolvedValue({
			queueDepth: 0,
			inFlight: 0,
			cancelRequests: 0,
			generatedAt: new Date().toISOString(),
			total: 0,
			pending: 0,
			inProgress: 0,
			done: 0,
			failed: 0,
			cancelled: 0,
		}),
		fetchTelemetryWindow: vi.fn().mockResolvedValue(null),
		...overrides,
	};
}

describe("refarm telemetry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("prints summary and no-pressure message by default", async () => {
		const deps = makeDeps();
		const command = createTelemetryCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		expect(deps.fetchTelemetry).toHaveBeenCalledOnce();
		expect(deps.fetchTelemetryWindow).toHaveBeenCalledWith(60);
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm Telemetry Snapshot");
		expect(output).toContain("no pressure signals");
	});

	it("emits core diagnostics in --json mode", async () => {
		const deps = makeDeps({
			fetchTelemetry: vi.fn().mockResolvedValue({
				queueDepth: 20,
				inFlight: 8,
				cancelRequests: 0,
				generatedAt: new Date().toISOString(),
				total: 30,
				pending: 10,
				inProgress: 8,
				done: 10,
				failed: 2,
				cancelled: 0,
			}),
		});
		const command = createTelemetryCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["--json", "--queue-warn", "5", "--inflight-warn", "3"],
			{
				from: "user",
			},
		);

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			diagnostics?: string[];
		};
		expect(payload.diagnostics).toContain("saturation:queue");
		expect(payload.diagnostics).toContain("saturation:inflight");
		expect(payload.diagnostics).toContain("reliability:failures-present");
	});

	it("uses profile thresholds and window diagnostics", async () => {
		const deps = makeDeps({
			fetchTelemetry: vi.fn().mockResolvedValue({
				queueDepth: 6,
				inFlight: 1,
				cancelRequests: 0,
				generatedAt: new Date().toISOString(),
				total: 12,
				pending: 1,
				inProgress: 1,
				done: 8,
				failed: 2,
				cancelled: 0,
			}),
			fetchTelemetryWindow: vi.fn().mockResolvedValue({
				windowMinutes: 15,
				since: new Date(Date.now() - 15 * 60_000).toISOString(),
				terminal: 4,
				failureRatePct: 25,
				generatedAt: new Date().toISOString(),
				total: 5,
				pending: 0,
				inProgress: 1,
				done: 2,
				failed: 1,
				cancelled: 1,
			}),
		});
		const command = createTelemetryCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["--json", "--profile", "conservative", "--window-minutes", "15"],
			{
				from: "user",
			},
		);

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			diagnostics?: string[];
		};
		expect(payload.diagnostics).toContain("saturation:queue");
		expect(payload.diagnostics).toContain("reliability:failures-recent");
		expect(payload.diagnostics).toContain("reliability:failure-rate");
	});
});
