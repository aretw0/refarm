import { PENDING_PROMPT_POLL_INTERVAL_MS, PENDING_PROMPT_POLL_MAX_INTERVAL_MS } from "@refarm.dev/prompt-contract-v1";
import { describe, expect, it } from "vitest";

import {
	ATTEND_DEFAULT_POLL_INTERVAL_MS,
	ATTEND_MAX_POLL_INTERVAL_MS,
	declaredAttendPollIntervalMs,
	nextAttendPollDelayMs,
	nextAttendRetryDelayMs,
} from "./poll.js";

describe("honest polling", () => {
	it("the floor and ceiling are the block's, not this surface's own numbers", () => {
		expect(ATTEND_DEFAULT_POLL_INTERVAL_MS).toBe(PENDING_PROMPT_POLL_INTERVAL_MS);
		expect(ATTEND_MAX_POLL_INTERVAL_MS).toBe(PENDING_PROMPT_POLL_MAX_INTERVAL_MS);
	});

	it("takes the interval the node ADVERTISED", () => {
		expect(declaredAttendPollIntervalMs({ pollIntervalMs: 5_000 })).toBe(5_000);
		expect(declaredAttendPollIntervalMs({ pollIntervalMs: 5_500.7 })).toBe(5_500);
	});

	it("never accepts a cadence faster than a node could have meant", () => {
		for (const body of [{}, undefined, null, { pollIntervalMs: 0 }, { pollIntervalMs: -1 }, { pollIntervalMs: Number.NaN }, { pollIntervalMs: "2s" }]) {
			expect(declaredAttendPollIntervalMs(body)).toBe(ATTEND_DEFAULT_POLL_INTERVAL_MS);
		}
	});

	it("never undercuts the declared interval, however many rounds have passed", () => {
		const base = 5_000;
		for (const rounds of [0, 1, 2, 5, 50]) {
			expect(nextAttendPollDelayMs(rounds, { base })).toBeGreaterThanOrEqual(base);
		}
	});

	it("something pending means the floor exactly; empty rounds double toward the ceiling", () => {
		expect(nextAttendPollDelayMs(0, { base: 2_000, max: 20_000 })).toBe(2_000);
		expect(nextAttendPollDelayMs(1, { base: 2_000, max: 20_000 })).toBe(4_000);
		expect(nextAttendPollDelayMs(2, { base: 2_000, max: 20_000 })).toBe(8_000);
		expect(nextAttendPollDelayMs(3, { base: 2_000, max: 20_000 })).toBe(16_000);
		expect(nextAttendPollDelayMs(4, { base: 2_000, max: 20_000 })).toBe(20_000);
	});

	it("a tab left open for a week stays at the ceiling — never Infinity, never zero", () => {
		const delay = nextAttendPollDelayMs(100_000, { base: 2_000, max: 20_000 });
		expect(delay).toBe(20_000);
		expect(Number.isFinite(delay)).toBe(true);
	});

	it("nonsense round counts fall back to the floor rather than to an instant retry", () => {
		for (const rounds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(nextAttendPollDelayMs(rounds, { base: 2_000 })).toBe(2_000);
		}
	});

	it("an unreachable node backs off harder than a calm farm does", () => {
		// Different curve on purpose: an empty round means nothing is wrong; a failed
		// request means something is, and hammering it helps nobody.
		expect(nextAttendRetryDelayMs(1, { max: 20_000 })).toBe(5_000);
		expect(nextAttendRetryDelayMs(2, { max: 20_000 })).toBe(10_000);
		expect(nextAttendRetryDelayMs(3, { max: 20_000 })).toBe(20_000);
		expect(nextAttendRetryDelayMs(99, { max: 20_000 })).toBe(20_000);
		expect(nextAttendRetryDelayMs(1, { max: 20_000 })).toBeGreaterThan(
			nextAttendPollDelayMs(0, { base: 2_000, max: 20_000 }),
		);
	});
});
