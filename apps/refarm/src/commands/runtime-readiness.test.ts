import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeRuntimeReady, waitForRuntimeReady } from "./runtime-readiness.js";

function response(ok: boolean): Response {
	return { ok } as Response;
}

describe("runtime readiness", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("returns true when the runtime probe endpoint responds ok", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(true)));

		await expect(probeRuntimeReady()).resolves.toBe(true);
	});

	it("returns false when the runtime probe endpoint rejects", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

		await expect(probeRuntimeReady()).resolves.toBe(false);
	});

	it("waits until a probe succeeds", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn()
				.mockResolvedValueOnce(response(false))
				.mockResolvedValueOnce(response(true)),
		);

		await expect(
			waitForRuntimeReady({
				timeoutMs: 100,
				pollIntervalMs: 1,
				probeTimeoutMs: 1,
			}),
		).resolves.toBe(true);
	});

	it("returns false when readiness does not arrive before timeout", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(false)));

		await expect(
			waitForRuntimeReady({
				timeoutMs: 1,
				pollIntervalMs: 1,
				probeTimeoutMs: 1,
			}),
		).resolves.toBe(false);
	});
});
