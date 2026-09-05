import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	handleRateLimitResponse,
	PLATFORM_LIMITS,
	rateLimitStatePath,
	throttle,
} from "./index.js";

let dir;
let statePath;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "refarm-rate-"));
	statePath = rateLimitStatePath(dir);
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** A clock the test moves by hand — pacing tested against real time is a flake. */
function fixedClock(start) {
	let value = start;
	return { now: () => value, advance: (ms) => (value += ms) };
}

describe("rateLimitStatePath", () => {
	it("derives the file under a base the caller names", () => {
		expect(rateLimitStatePath("/x/y")).toBe("/x/y/rate-limits.json");
	});

	it("refuses to guess a base", () => {
		// The original baked in one consumer's home directory. A library that picks where a
		// caller's machine-local state lives has decided something that is not its to decide.
		expect(() => rateLimitStatePath("")).toThrow(/directory/);
	});
});

describe("throttle", () => {
	it("does not wait on a first send, and says so by returning nothing", async () => {
		const sleep = vi.fn();
		const waits = await throttle("telegram", { statePath, sleep, now: () => 1_000_000 });
		expect(waits).toEqual([]);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("waits the remaining gap when two sends are too close", async () => {
		const clock = fixedClock(1_000_000);
		const sleep = vi.fn();
		await throttle("telegram", { statePath, sleep, now: clock.now });
		clock.advance(100);
		const waits = await throttle("telegram", { statePath, sleep, now: clock.now });
		// telegram's minimum gap is 1100ms and 100ms passed, so 1000ms remain.
		expect(waits).toEqual([{ platform: "telegram", reason: "min-delay", waitedMs: 1000 }]);
		expect(sleep).toHaveBeenCalledWith(1000);
	});

	it("REPORTS a wait instead of printing it", async () => {
		const clock = fixedClock(1_000_000);
		const onWait = vi.fn();
		await throttle("telegram", { statePath, sleep: async () => {}, now: clock.now, onWait });
		clock.advance(10);
		await throttle("telegram", { statePath, sleep: async () => {}, now: clock.now, onWait });
		// The original wrote to the console, in one human language, from inside a library.
		expect(onWait).toHaveBeenCalledWith({
			platform: "telegram",
			reason: "min-delay",
			waitedMs: 1090,
		});
	});

	it("waits out the window when the burst ceiling is reached", async () => {
		const clock = fixedClock(1_000_000);
		const limits = { minDelayMs: 0, burstLimit: 2, burstWindowMs: 10_000 };
		const sleep = vi.fn();
		await throttle("x", { statePath, limits, sleep, now: clock.now });
		clock.advance(10);
		await throttle("x", { statePath, limits, sleep, now: clock.now });
		clock.advance(10);
		const waits = await throttle("x", { statePath, limits, sleep, now: clock.now });
		expect(waits.map((wait) => wait.reason)).toContain("burst-window");
	});

	it("does not pace a platform nobody measured", async () => {
		const sleep = vi.fn();
		// Inventing a limit for an unknown provider would be a guessed number in a durable place.
		const waits = await throttle("carrier-pigeon", { statePath, sleep, now: () => 1 });
		expect(waits).toEqual([]);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("refuses to run without a state path rather than choosing one", async () => {
		await expect(throttle("telegram", { sleep: async () => {} })).rejects.toThrow(/statePath/);
	});

	it("treats unreadable state as no state rather than refusing to send", async () => {
		writeFileSync(statePath, "{ not json");
		// A REALISTIC CLOCK, deliberately: `lastSentAt: 0` is the "never sent" sentinel and is
		// compared arithmetically, so a clock near zero makes a first send look recent. That is a
		// property of the fixture, not of the limiter.
		const waits = await throttle("telegram", { statePath, sleep: async () => {}, now: () => 1_700_000_000_000 });
		// A corrupt pacing file costs one send paced from scratch; refusing would stop a pipeline.
		expect(waits).toEqual([]);
	});

	it("leaves no partial file behind", async () => {
		await throttle("telegram", { statePath, sleep: async () => {}, now: () => 7 });
		const written = JSON.parse(readFileSync(statePath, "utf8"));
		expect(written.telegram.sentInWindow).toBe(1);
		expect(written.telegram.lastSentAt).toBe(7);
	});
});

describe("handleRateLimitResponse", () => {
	it("reads Telegram's nested retry_after, in seconds", () => {
		expect(
			handleRateLimitResponse({ ok: false, error_code: 429, parameters: { retry_after: 12 } }, "telegram"),
		).toBe(12_000);
	});

	it("falls back to thirty seconds when a 429 carries no delay", () => {
		expect(handleRateLimitResponse({ error_code: 429 }, "telegram")).toBe(30_000);
	});

	it("reads a generic 429", () => {
		expect(handleRateLimitResponse({ status: 429, retryAfter: 3 }, "bluesky")).toBe(3_000);
	});

	it("returns zero for anything that is not a rate-limit answer", () => {
		// ZERO IS "not a rate-limit answer", which is the same as not waiting — not "wait zero".
		expect(handleRateLimitResponse({ ok: true }, "telegram")).toBe(0);
		expect(handleRateLimitResponse(null, "telegram")).toBe(0);
		expect(handleRateLimitResponse("nope", "telegram")).toBe(0);
	});
});

describe("the platform table", () => {
	it("stays below the published ceilings it documents", () => {
		// Telegram publishes 1 msg/s per chat; 1100ms leaves room for the clock disagreeing.
		expect(PLATFORM_LIMITS.telegram.minDelayMs).toBeGreaterThan(1000);
		for (const [platform, limit] of Object.entries(PLATFORM_LIMITS)) {
			expect(limit.minDelayMs, platform).toBeGreaterThan(0);
			expect(limit.burstLimit, platform).toBeGreaterThan(0);
			expect(limit.burstWindowMs, platform).toBeGreaterThan(0);
		}
	});
});
