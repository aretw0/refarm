import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSidecar } from "./http.js";
import { createSessionsRouteHandler } from "./sessions.js";

function makeAdapter() {
	return {
		submit: vi.fn().mockResolvedValue("e1"),
		query: vi.fn().mockResolvedValue(null),
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

async function requestRaw(
	port: number,
	method: string,
	path: string,
	rawBody: string,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				method,
				path,
				agent: false,
				headers: {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(rawBody),
				},
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
		req.write(rawBody);
		req.end();
	});
}

describe("sessions route handler", () => {
	let sidecar: HttpSidecar;
	const PORT = 42109;
	const adapter = makeAdapter();
	const store = {
		queryNodes: vi.fn(),
		storeNode: vi.fn(),
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		sidecar = new HttpSidecar(PORT, adapter);
		sidecar.addRouteHandler(createSessionsRouteHandler(store as any));
		await sidecar.start();
	});

	afterEach(async () => {
		await sidecar.stop();
	});

	it("GET /sessions lists Session nodes", async () => {
		store.queryNodes.mockResolvedValueOnce([
			{
				"@type": "Session",
				"@id": "urn:refarm:session:v1:abc",
				name: "alpha",
				created_at_ns: 42,
			},
		]);

		const { status, body } = await request(PORT, "GET", "/sessions");
		expect(status).toBe(200);
		expect(store.queryNodes).toHaveBeenCalledWith("Session");
		expect((body as any).sessions).toEqual([
			expect.objectContaining({
				"@id": "urn:refarm:session:v1:abc",
				name: "alpha",
			}),
		]);
	});

	it("POST /sessions creates and stores a session node", async () => {
		store.storeNode.mockResolvedValueOnce(undefined);

		const { status, body } = await request(PORT, "POST", "/sessions", {
			name: "auth-refactor",
		});
		expect(status).toBe(200);
		expect((body as any).session?.name).toBe("auth-refactor");
		expect((body as any).session?.["@id"]).toMatch(
			/^urn:refarm:session:v1:[a-f0-9]+$/,
		);
		expect(store.storeNode).toHaveBeenCalledWith(
			expect.objectContaining({
				"@type": "Session",
				name: "auth-refactor",
			}),
		);
	});

	it("POST /sessions rejects invalid JSON payload", async () => {
		const { status, body } = await requestRaw(PORT, "POST", "/sessions", "{");
		expect(status).toBe(400);
		expect(body).toEqual({ error: "invalid json" });
	});
});
