import type { EffortResult, EffortStatus } from "@refarm.dev/effort-contract-v1";
import { describe, expect, it } from "vitest";
import { summarizeEfforts, summarizeEffortWindow } from "./effort-summary.js";

function result(status: EffortStatus, completedAt?: string): EffortResult {
	return {
		effortId: `${status}-${completedAt ?? "unstamped"}`,
		status,
		results: [],
		completedAt,
	};
}

describe("effort summary", () => {
	it("counts every lifecycle status", () => {
		const summary = summarizeEfforts([
			result("pending"),
			result("in-progress"),
			result("done"),
			result("delivered"),
			result("partial"),
			result("failed"),
			result("timed-out"),
			result("cancelled"),
		]);

		expect(summary).toEqual({
			total: 8,
			pending: 1,
			inProgress: 1,
			done: 1,
			delivered: 1,
			partial: 1,
			failed: 1,
			timedOut: 1,
			cancelled: 1,
		});
	});

	it("builds a deterministic inclusive telemetry window", () => {
		const nowMs = Date.parse("2026-08-06T12:00:00.000Z");
		const window = summarizeEffortWindow(
			[
				result("done", "2026-08-06T11:00:00.000Z"),
				result("failed", "2026-08-06T11:30:00.000Z"),
				result("failed", "2026-08-06T10:59:59.999Z"),
				result("pending", "invalid"),
			],
			60,
			nowMs,
		);

		expect(window).toEqual({
			total: 2,
			pending: 0,
			inProgress: 0,
			done: 1,
			delivered: 0,
			partial: 0,
			failed: 1,
			timedOut: 0,
			cancelled: 0,
			windowMinutes: 60,
			since: "2026-08-06T11:00:00.000Z",
			terminal: 2,
			failureRatePct: 50,
			generatedAt: "2026-08-06T12:00:00.000Z",
		});
	});

	it("normalizes an invalid window to sixty minutes", () => {
		const nowMs = Date.parse("2026-08-06T12:00:00.000Z");
		const window = summarizeEffortWindow([], Number.NaN, nowMs);

		expect(window.windowMinutes).toBe(60);
		expect(window.failureRatePct).toBeNull();
	});
});
