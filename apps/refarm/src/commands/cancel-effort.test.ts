import { describe, expect, it } from "vitest";

import { cancelEffortViaSidecar, classifyCancel } from "./cancel-effort.js";

describe("classifyCancel — the honest cancel verdict", () => {
	it("202 → cancelled (the turn was interrupted)", () => {
		const v = classifyCancel(202);
		expect(v.status).toBe("cancelled");
		expect(v.message).toMatch(/interrupted/i);
	});

	it("409 → already-terminal (raced with the answer landing)", () => {
		expect(classifyCancel(409).status).toBe("already-terminal");
	});

	it("404 → not-found", () => {
		expect(classifyCancel(404).status).toBe("not-found");
	});

	it("any other status → runtime-unreachable", () => {
		expect(classifyCancel(500).status).toBe("runtime-unreachable");
		expect(classifyCancel(null).status).toBe("runtime-unreachable");
	});
});

describe("cancelEffortViaSidecar — POSTs the cancel and classifies", () => {
	it("POSTs /efforts/:id/cancel and maps 202 → cancelled", async () => {
		const calls: string[] = [];
		const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
			calls.push(`${init?.method ?? "GET"} ${String(url)}`);
			return { status: 202, ok: true } as Response;
		}) as unknown as typeof fetch;

		const result = await cancelEffortViaSidecar("abc-123", {
			sidecarUrl: "http://127.0.0.1:42001",
			fetchImpl: fakeFetch,
		});
		expect(result.status).toBe("cancelled");
		expect(calls).toEqual(["POST http://127.0.0.1:42001/efforts/abc-123/cancel"]);
	});

	it("url-encodes the effort id", async () => {
		const calls: string[] = [];
		const fakeFetch = (async (url: string | URL) => {
			calls.push(String(url));
			return { status: 202, ok: true } as Response;
		}) as unknown as typeof fetch;

		await cancelEffortViaSidecar("a/b c", {
			sidecarUrl: "http://127.0.0.1:42001",
			fetchImpl: fakeFetch,
		});
		expect(calls[0]).toContain("/efforts/a%2Fb%20c/cancel");
	});

	it("a fetch failure becomes runtime-unreachable, never throws", async () => {
		const fakeFetch = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		const result = await cancelEffortViaSidecar("abc", {
			sidecarUrl: "http://127.0.0.1:42001",
			fetchImpl: fakeFetch,
		});
		expect(result.status).toBe("runtime-unreachable");
	});
});
