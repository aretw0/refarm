import { describe, expect, it, vi } from "vitest";
import {
	fetchSidecarWithTimeout,
	resolveSidecarRequestTimeoutMs,
	SIDECAR_REQUEST_TIMEOUT_ENV_VAR,
} from "../src/index.js";

describe("sidecar-client", () => {
	it("resolves the sidecar timeout from its own env var, else the default", () => {
		expect(
			resolveSidecarRequestTimeoutMs({ [SIDECAR_REQUEST_TIMEOUT_ENV_VAR]: "1200" }),
		).toBe(1200);
		expect(resolveSidecarRequestTimeoutMs({})).toBe(500);
	});

	it("fetches through the injected fetch impl (domain-owned, no reimplementation)", async () => {
		const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
		const res = await fetchSidecarWithTimeout(
			"http://127.0.0.1:42001/efforts",
			{},
			{ fetch: fetchMock as unknown as typeof fetch },
		);
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url] = fetchMock.mock.calls[0]!;
		expect(String(url)).toBe("http://127.0.0.1:42001/efforts");
	});
});
