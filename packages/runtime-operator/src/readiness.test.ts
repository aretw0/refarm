import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	probeRuntimeLiveness,
	probeRuntimeReadiness,
	probeRuntimeReady,
	waitForRuntimeOutcome,
} from "./readiness.js";

const SIDECAR = "http://127.0.0.1:42001";

function response(ok: boolean, status = ok ? 200 : 503): Response {
	return { ok, status } as Response;
}

describe("runtime-operator readiness (injected sidecar URL)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("is ready when both /efforts/summary and /sessions answer ok", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(true)),
		);
		await expect(probeRuntimeReady(SIDECAR)).resolves.toBe(true);
	});

	it("does not probe /sessions when /efforts/summary is unreachable", async () => {
		const fetch = vi.fn().mockRejectedValueOnce(new Error("down"));
		vi.stubGlobal("fetch", fetch);
		await expect(probeRuntimeReady(SIDECAR)).resolves.toBe(false);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]?.[0]).toBe(`${SIDECAR}/efforts/summary`);
	});

	it("reports /sessions as the additional readiness requirement", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(false, 503)),
		);
		await expect(probeRuntimeReadiness(SIDECAR)).resolves.toEqual({
			url: `${SIDECAR}/sessions`,
			ready: false,
			status: 503,
		});
	});

	it("liveness checks only /efforts/summary", async () => {
		const fetch = vi.fn().mockResolvedValueOnce(response(true));
		vi.stubGlobal("fetch", fetch);
		await expect(probeRuntimeLiveness(SIDECAR)).resolves.toEqual({
			url: `${SIDECAR}/efforts/summary`,
			ready: true,
			status: 200,
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("accepts an async URL resolver and strips a trailing slash", async () => {
		const fetch = vi.fn().mockResolvedValue(response(true));
		vi.stubGlobal("fetch", fetch);
		await probeRuntimeLiveness(async () => `${SIDECAR}/`);
		expect(fetch.mock.calls[0]?.[0]).toBe(`${SIDECAR}/efforts/summary`);
	});

	it("surfaces a fetch error cause in the probe diagnostics", async () => {
		const error = new Error("fetch failed", {
			cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:42001"), {
				code: "ECONNREFUSED",
			}),
		});
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
		await expect(probeRuntimeReadiness(SIDECAR)).resolves.toEqual({
			url: `${SIDECAR}/efforts/summary`,
			ready: false,
			error: "fetch failed: ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:42001",
		});
	});
});

describe("waitForRuntimeOutcome (honest timeout: alive-but-booting vs dead)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const fastWait = { timeoutMs: 40, pollIntervalMs: 5, probeTimeoutMs: 20 } as const;
	const refused = () =>
		new Error("fetch failed", {
			cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:42001"), {
				code: "ECONNREFUSED",
			}),
		});

	it("returns ready as soon as both endpoints answer", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(true)),
		);
		const outcome = await waitForRuntimeOutcome(SIDECAR, fastWait);
		expect(outcome.ready).toBe(true);
		expect(outcome.status).toBe("ready");
	});

	it("times out as DEAD when every probe is connection-refused", async () => {
		// Nobody ever listens → the daemon is genuinely absent.
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(refused()));
		const outcome = await waitForRuntimeOutcome(SIDECAR, fastWait);
		expect(outcome.ready).toBe(false);
		expect(outcome.status).toBe("timed-out-dead");
	});

	it("times out as ALIVE when the daemon answers but is never ready (503 booting)", async () => {
		// /efforts/summary responds (a 503 = someone is there, still coming up) but never
		// reaches ready before the deadline. This is the cold-boot case the old boolean lost.
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(false, 503)));
		const outcome = await waitForRuntimeOutcome(SIDECAR, fastWait);
		expect(outcome.ready).toBe(false);
		expect(outcome.status).toBe("timed-out-alive");
	});

	it("treats a probe TIMEOUT (not a refusal) as alive-but-slow", async () => {
		// An AbortError-style timeout means the socket connected but the response was slow —
		// the daemon is up, just not answering in time. Must NOT be classified as dead.
		const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
		const outcome = await waitForRuntimeOutcome(SIDECAR, fastWait);
		expect(outcome.ready).toBe(false);
		expect(outcome.status).toBe("timed-out-alive");
	});
});
