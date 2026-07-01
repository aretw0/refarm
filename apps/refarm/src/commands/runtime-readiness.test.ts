import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	probeRuntimeLiveness,
	probeRuntimeReadiness,
	probeRuntimeReady,
	waitForRuntimeReady,
} from "./runtime-readiness.js";

function response(ok: boolean, status = ok ? 200 : 503): Response {
	return { ok, status } as Response;
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

	it("returns readiness probe details when the runtime responds", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(false, 503)));

		await expect(probeRuntimeReadiness()).resolves.toEqual({
			url: "http://127.0.0.1:42001/efforts/summary",
			ready: false,
			status: 503,
		});
	});

	it("returns false when the runtime probe endpoint rejects", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

		await expect(probeRuntimeReady()).resolves.toBe(false);
	});

	it("does not probe /sessions when /efforts/summary is unreachable", async () => {
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new Error("down"));
		vi.stubGlobal("fetch", fetch);

		await expect(probeRuntimeReady()).resolves.toBe(false);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]?.[0]).toBe(
			"http://127.0.0.1:42001/efforts/summary",
		);
	});

	it("checks /sessions as an additional readiness requirement", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(false, 503)),
		);

		await expect(probeRuntimeReadiness()).resolves.toEqual({
			url: "http://127.0.0.1:42001/sessions",
			ready: false,
			status: 503,
		});
	});

	it("checks liveness without requiring the session endpoint", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response(true))
			.mockResolvedValueOnce(response(false, 503));
		vi.stubGlobal("fetch", fetch);

		await expect(probeRuntimeLiveness()).resolves.toEqual({
			url: "http://127.0.0.1:42001/efforts/summary",
			ready: true,
			status: 200,
		});

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]?.[0]).toBe(
			"http://127.0.0.1:42001/efforts/summary",
		);
	});

	it("returns readiness probe transport errors", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

		await expect(probeRuntimeReadiness()).resolves.toEqual({
			url: "http://127.0.0.1:42001/efforts/summary",
			ready: false,
			error: "down",
		});
	});

	it("includes fetch error causes in readiness probe diagnostics", async () => {
		const error = new Error("fetch failed", {
			cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:42001"), {
				code: "ECONNREFUSED",
			}),
		});
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

		await expect(probeRuntimeReadiness()).resolves.toEqual({
			url: "http://127.0.0.1:42001/efforts/summary",
			ready: false,
			error: "fetch failed: ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:42001",
		});
	});

	it("waits until a probe succeeds", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValueOnce(response(false)).mockResolvedValue(response(true)),
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
