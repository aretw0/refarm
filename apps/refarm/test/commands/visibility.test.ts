import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisibilityDeps } from "../../src/commands/visibility.js";
import { createVisibilityCommand } from "../../src/commands/visibility.js";

function makeDeps(overrides: Partial<VisibilityDeps> = {}): VisibilityDeps {
	return {
		fetchVisibility: vi.fn().mockResolvedValue({
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
		fetchVisibilityWindow: vi.fn().mockResolvedValue(null),
		...overrides,
	};
}

describe("refarm visibility", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("prints summary and no-pressure message by default", async () => {
		const deps = makeDeps();
		const command = createVisibilityCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		expect(deps.fetchVisibility).toHaveBeenCalledOnce();
		expect(deps.fetchVisibilityWindow).toHaveBeenCalledWith(60);
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm Visibility Snapshot");
		expect(output).toContain("no pressure signals");
	});

	it("emits core diagnostics in --json mode", async () => {
		const deps = makeDeps({
			fetchVisibility: vi.fn().mockResolvedValue({
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
		const command = createVisibilityCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--json", "--queue-warn", "5", "--inflight-warn", "3"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			diagnostics?: string[];
		};
		expect(payload.diagnostics).toContain("pressure:queue-depth");
		expect(payload.diagnostics).toContain("pressure:in-flight");
		expect(payload.diagnostics).toContain("efforts:failed-present");
	});

	it("uses profile thresholds and window diagnostics", async () => {
		const deps = makeDeps({
			fetchVisibility: vi.fn().mockResolvedValue({
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
			fetchVisibilityWindow: vi.fn().mockResolvedValue({
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
		const command = createVisibilityCommand(deps);
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
		expect(payload.diagnostics).toContain("pressure:queue-depth");
		expect(payload.diagnostics).toContain("efforts:failed-recent");
		expect(payload.diagnostics).toContain("pressure:failure-rate");
	});
});
