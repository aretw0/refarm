import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { createEffortProxyHandler, isEffortProxyRequest } from "../../src/commands/effort-proxy.js";

describe("isEffortProxyRequest", () => {
	it("matches the /efforts prefix and its subpaths", () => {
		expect(isEffortProxyRequest("/efforts")).toBe(true);
		expect(isEffortProxyRequest("/efforts/abc")).toBe(true);
		expect(isEffortProxyRequest("/efforts/abc/cancel")).toBe(true);
		expect(isEffortProxyRequest("/efforts?x=1")).toBe(true);
	});

	it("does not match other paths (they fall through to the capability surface)", () => {
		expect(isEffortProxyRequest("/capabilities/foo")).toBe(false);
		expect(isEffortProxyRequest("/agent-tools")).toBe(false);
		expect(isEffortProxyRequest("/effortsX")).toBe(false); // not a subpath
		expect(isEffortProxyRequest(undefined)).toBe(false);
	});
});

function mockReq(method: string, url: string, body?: string): IncomingMessage {
	const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
	req.method = method;
	req.url = url;
	req.headers = body ? { "content-type": "application/json" } : {};
	// Emit the body on next tick so the handler's listeners are attached first.
	queueMicrotask(() => {
		if (body) req.emit("data", Buffer.from(body));
		req.emit("end");
	});
	return req;
}

function mockRes(): ServerResponse & { body: string } {
	const res = {
		statusCode: 0,
		headers: {} as Record<string, string>,
		body: "",
		setHeader(k: string, v: string) {
			this.headers[k.toLowerCase()] = v;
		},
		end(chunk?: string) {
			if (chunk) this.body += chunk;
		},
	};
	return res as unknown as ServerResponse & { body: string };
}

describe("createEffortProxyHandler", () => {
	it("passes non-effort requests through to next untouched", () => {
		const next = vi.fn();
		const handler = createEffortProxyHandler(next, {
			resolveSidecar: () => "http://127.0.0.1:42001",
			fetchImpl: async () => new Response("{}"),
		});
		const req = mockReq("GET", "/agent-tools");
		const res = mockRes();
		handler(req, res);
		expect(next).toHaveBeenCalledOnce();
	});

	it("proxies POST /efforts to the sidecar and returns its response verbatim", async () => {
		const seen: { url?: string; method?: string; body?: unknown } = {};
		const handler = createEffortProxyHandler(vi.fn(), {
			resolveSidecar: () => "http://127.0.0.1:42001",
			fetchImpl: async (url, init) => {
				seen.url = url;
				seen.method = init.method;
				seen.body = init.body;
				return new Response(JSON.stringify({ effortId: "eff-1" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});
		const req = mockReq("POST", "/efforts", JSON.stringify({ direction: "ask" }));
		const res = mockRes();
		handler(req, res);
		await vi.waitFor(() => expect(res.body).not.toBe(""));

		expect(seen.url).toBe("http://127.0.0.1:42001/efforts");
		expect(seen.method).toBe("POST");
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ effortId: "eff-1" });
	});

	it("proxies POST /efforts/:id/cancel", async () => {
		let target = "";
		const handler = createEffortProxyHandler(vi.fn(), {
			resolveSidecar: () => "http://127.0.0.1:42001",
			fetchImpl: async (url) => {
				target = url;
				return new Response(JSON.stringify({ accepted: true, status: "cancelled" }), {
					status: 202,
					headers: { "content-type": "application/json" },
				});
			},
		});
		const req = mockReq("POST", "/efforts/eff-1/cancel");
		const res = mockRes();
		handler(req, res);
		await vi.waitFor(() => expect(res.body).not.toBe(""));

		expect(target).toBe("http://127.0.0.1:42001/efforts/eff-1/cancel");
		expect(res.statusCode).toBe(202);
	});

	it("returns 502 when the sidecar is unreachable", async () => {
		const handler = createEffortProxyHandler(vi.fn(), {
			resolveSidecar: () => "http://127.0.0.1:42001",
			fetchImpl: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		const req = mockReq("POST", "/efforts", "{}");
		const res = mockRes();
		handler(req, res);
		await vi.waitFor(() => expect(res.body).not.toBe(""));

		expect(res.statusCode).toBe(502);
		expect(JSON.parse(res.body).error).toBe("effort-proxy-failed");
	});
});
