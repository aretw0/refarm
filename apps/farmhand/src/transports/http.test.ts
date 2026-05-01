import http from "node:http";
import type { Effort, EffortResult } from "@refarm.dev/effort-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSidecar } from "./http.js";

function makeAdapter(result: EffortResult | null = null) {
	return {
		submit: vi.fn().mockResolvedValue("e1"),
		query: vi.fn().mockResolvedValue(result),
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
});
