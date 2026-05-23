import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelemetryDeps } from "../../src/commands/telemetry.js";
import {
	buildTelemetryRecommendations,
	createTelemetryCommand,
} from "../../src/commands/telemetry.js";

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
		expect(output).toContain("update/restart the Refarm runtime");
		expect(output).toContain("no pressure signals");
	});

	it("documents strict telemetry gate usage in help", () => {
		const command = createTelemetryCommand(makeDeps());
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("refarm telemetry --json --strict");
		expect(help).toContain("refarm runtime status");
		expect(help).toContain("refarm runtime start --wait");
		expect(help).toContain("refarm doctor");
	});

	it("rejects invalid profile before fetching telemetry", async () => {
		const deps = makeDeps();
		const command = createTelemetryCommand(deps);
		command.exitOverride((error) => {
			throw error;
		});

		await expect(
			command.parseAsync(["--profile", "aggressive"], { from: "user" }),
		).rejects.toThrow(
			'invalid profile "aggressive". Use: conservative | balanced | throughput',
		);
		expect(deps.fetchTelemetry).not.toHaveBeenCalled();
		expect(deps.fetchTelemetryWindow).not.toHaveBeenCalled();
	});

	it("rejects invalid numeric thresholds before fetching telemetry", async () => {
		const deps = makeDeps();
		const command = createTelemetryCommand(deps);
		command.exitOverride((error) => {
			throw error;
		});

		await expect(
			command.parseAsync(["--window-minutes", "soon"], { from: "user" }),
		).rejects.toThrow("--window-minutes must be a positive integer.");
		expect(deps.fetchTelemetry).not.toHaveBeenCalled();
		expect(deps.fetchTelemetryWindow).not.toHaveBeenCalled();
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
			recommendations?: Array<{ diagnostic: string }>;
		};
		expect(payload.diagnostics).toContain("saturation:queue");
		expect(payload.diagnostics).toContain("saturation:inflight");
		expect(payload.diagnostics).toContain("reliability:failures-present");
		expect(payload.recommendations?.map((item) => item.diagnostic)).toEqual(
			expect.arrayContaining([
				"saturation:queue",
				"saturation:inflight",
				"reliability:failures-present",
			]),
		);
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

	it("fails strict gate with exit code 2 when diagnostics are present", async () => {
		const deps = makeDeps({
			fetchTelemetry: vi.fn().mockResolvedValue({
				queueDepth: 20,
				inFlight: 8,
				cancelRequests: 0,
				generatedAt: new Date().toISOString(),
				total: 30,
				pending: 0,
				inProgress: 0,
				done: 22,
				failed: 8,
				cancelled: 0,
			}),
		});
		const command = createTelemetryCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		await expect(
			command.parseAsync(["--json", "--strict"], { from: "user" }),
		).rejects.toThrow("exit:2");

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			strict?: { passed?: boolean; matchedDiagnostics?: string[] };
		};
		expect(payload.strict?.passed).toBe(false);
		expect(payload.strict?.matchedDiagnostics?.length).toBeGreaterThan(0);
		expect(exitSpy).toHaveBeenCalledWith(2);

		exitSpy.mockRestore();
	});

	it("strict-on filters diagnostics and passes when no selected code matches", async () => {
		const deps = makeDeps({
			fetchTelemetry: vi.fn().mockResolvedValue({
				queueDepth: 20,
				inFlight: 8,
				cancelRequests: 0,
				generatedAt: new Date().toISOString(),
				total: 30,
				pending: 0,
				inProgress: 0,
				done: 22,
				failed: 8,
				cancelled: 0,
			}),
		});
		const command = createTelemetryCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		await command.parseAsync(
			["--json", "--strict", "--strict-on", "reliability:failure-rate"],
			{ from: "user" },
		);

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			strict?: { passed?: boolean; matchedDiagnostics?: string[] };
		};
		expect(payload.strict?.passed).toBe(true);
		expect(payload.strict?.matchedDiagnostics).toEqual([]);
		expect(exitSpy).not.toHaveBeenCalled();

		exitSpy.mockRestore();
	});

	it("prints recommendations in summary mode when diagnostics are present", async () => {
		const deps = makeDeps({
			fetchTelemetry: vi.fn().mockResolvedValue({
				queueDepth: 20,
				inFlight: 0,
				cancelRequests: 0,
				generatedAt: new Date().toISOString(),
				total: 30,
				pending: 20,
				inProgress: 0,
				done: 10,
				failed: 0,
				cancelled: 0,
			}),
		});
		const command = createTelemetryCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--queue-warn", "5"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Recommendations");
		expect(output).toContain("saturation:queue");
	});
});

describe("buildTelemetryRecommendations", () => {
	it("creates stable recommendations for telemetry diagnostics", () => {
		expect(
			buildTelemetryRecommendations([
				"saturation:queue",
				"reliability:failure-rate",
				"custom:diagnostic",
			]),
		).toEqual([
			{
				diagnostic: "saturation:queue",
				summary: "The task queue is above the configured warning threshold.",
				action: "Reduce new submissions, scale workers, or inspect long-running efforts before dispatching more work.",
			},
			{
				diagnostic: "reliability:failure-rate",
				summary: "Recent failure rate is above the configured warning threshold.",
				action: "Pause non-essential automation and investigate the dominant failing tasks.",
			},
			{
				diagnostic: "custom:diagnostic",
				summary: "Telemetry diagnostic custom:diagnostic is present.",
				action: "Inspect telemetry payload and runtime logs for the diagnostic source.",
			},
		]);
	});
});
