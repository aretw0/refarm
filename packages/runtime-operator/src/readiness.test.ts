import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	probeRuntimeLiveness,
	probeRuntimeReadiness,
	probeRuntimeReady,
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
