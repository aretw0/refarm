import http from "node:http";
import type { Effort, EffortResult } from "@refarm.dev/effort-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSidecar } from "./http.js";

function makeAdapter(result: EffortResult | null = null) {
	return {
		submit: vi.fn().mockResolvedValue("e1"),
		query: vi.fn().mockResolvedValue(result),
		list: vi.fn().mockResolvedValue([]),
		logs: vi.fn().mockResolvedValue([]),
		retry: vi.fn().mockResolvedValue(true),
		cancel: vi.fn().mockResolvedValue(true),
		summary: vi.fn().mockResolvedValue({
			total: 0,
			pending: 0,
			inProgress: 0,
			done: 0,
			failed: 0,
			cancelled: 0,
		}),
		visibility: vi.fn().mockResolvedValue({
			queueDepth: 0,
			inFlight: 0,
			cancelRequests: 0,
			generatedAt: new Date().toISOString(),
			total: 0,
			pending: 0,
			inProgress: 0,
			done: 0,
			failed: 0,
			cancelled: 0,
		}),
		process: vi.fn().mockResolvedValue(undefined),
	};
}

async function request(
	port: number,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const payload = body ? JSON.stringify(body) : undefined;
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				method,
				path,
				agent: false,
				headers: payload
					? {
							"content-type": "application/json",
							"content-length": Buffer.byteLength(payload),
						}
					: {},
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					resolve({
						status: res.statusCode ?? 0,
						body: JSON.parse(data || "null"),
					});
				});
			},
		);
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});
}

describe("HttpSidecar", () => {
	let sidecar: HttpSidecar;
	let adapter: ReturnType<typeof makeAdapter>;
	const PORT = 42099;

	beforeEach(async () => {
		adapter = makeAdapter();
		sidecar = new HttpSidecar(PORT, adapter);
		await sidecar.start();
	});

	afterEach(async () => {
		await sidecar.stop();
	});

	it("POST /efforts returns effortId", async () => {
		const effort: Effort = {
			id: "e1",
			direction: "test",
			tasks: [],
			submittedAt: new Date().toISOString(),
		};
		const { status, body } = await request(PORT, "POST", "/efforts", effort);
		expect(status).toBe(200);
		expect((body as any).effortId).toBe("e1");
		expect(adapter.submit).toHaveBeenCalled();
	});

	it("GET /efforts/:id returns EffortResult when found", async () => {
		const mockResult: EffortResult = {
			effortId: "e1",
			status: "done",
			results: [],
			completedAt: new Date().toISOString(),
		};
		adapter.query.mockResolvedValueOnce(mockResult);

		const { status, body } = await request(PORT, "GET", "/efforts/e1");
		expect(status).toBe(200);
		expect((body as any).effortId).toBe("e1");
	});

	it("GET /efforts/:id returns 404 when not found", async () => {
		adapter.query.mockResolvedValueOnce(null);
		const { status } = await request(PORT, "GET", "/efforts/unknown");
		expect(status).toBe(404);
	});

	it("returns 404 for unknown routes", async () => {
		const { status } = await request(PORT, "GET", "/unknown");
		expect(status).toBe(404);
	});

	it("delegates to custom route handlers before built-in routes", async () => {
		sidecar.addRouteHandler((req, res) => {
			if (req.method === "GET" && req.url === "/custom") {
				res.writeHead(200, {
					"content-type": "application/json",
				});
				res.end(JSON.stringify({ ok: true }));
				return true;
			}
			return false;
		});

		const { status, body } = await request(PORT, "GET", "/custom");
		expect(status).toBe(200);
		expect((body as any).ok).toBe(true);
	});

	it("GET /efforts returns effort list", async () => {
		adapter.list.mockResolvedValueOnce([
			{
				effortId: "e1",
				status: "pending",
				results: [],
			},
		]);

		const { status, body } = await request(PORT, "GET", "/efforts");
		expect(status).toBe(200);
		expect(Array.isArray(body)).toBe(true);
		expect((body as any[])[0]?.effortId).toBe("e1");
	});

	it("GET /visibility returns runtime visibility snapshot", async () => {
		const { status, body } = await request(PORT, "GET", "/visibility");
		expect(status).toBe(200);
		expect(adapter.visibility).toHaveBeenCalled();
		expect((body as any).queueDepth).toBe(0);
	});

	it("GET /efforts/:id/logs returns logs", async () => {
		adapter.logs.mockResolvedValueOnce([
			{
				effortId: "e1",
				timestamp: new Date().toISOString(),
				level: "info",
				event: "submitted",
				message: "submitted",
			},
		]);

		const { status, body } = await request(PORT, "GET", "/efforts/e1/logs");
		expect(status).toBe(200);
		expect(Array.isArray(body)).toBe(true);
	});

	it("POST /efforts/:id/retry returns accepted", async () => {
		adapter.retry.mockResolvedValueOnce(true);
		const { status } = await request(PORT, "POST", "/efforts/e1/retry");
		expect(status).toBe(202);
		expect(adapter.retry).toHaveBeenCalledWith("e1");
	});

	it("POST /efforts/:id/cancel returns conflict when rejected", async () => {
		adapter.cancel.mockResolvedValueOnce(false);
		const { status } = await request(PORT, "POST", "/efforts/e1/cancel");
		expect(status).toBe(409);
	});
});
