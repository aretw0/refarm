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
	// Ephemeral port per test (see http.test.ts) — a fixed port races the previous test's
	// stop() releasing it under CI load.
	let PORT = 0;
	const adapter = makeAdapter();
	const store = {
		queryNodes: vi.fn(),
		storeNode: vi.fn(),
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		sidecar = new HttpSidecar(0, adapter);
		sidecar.addRouteHandler(createSessionsRouteHandler(store));
		await sidecar.start();
		const address = sidecar.httpServer.address();
		PORT = typeof address === "object" && address !== null ? address.port : 0;
	});

	afterEach(async () => {
		await sidecar.stop();
	});

	it("GET /sessions lists Session nodes", async () => {
		store.queryNodes.mockResolvedValueOnce([
			{
				"@type": "Session",
				"@id": "urn:sovereign:session:v1:abc",
				name: "alpha",
				created_at_ns: 42,
			},
		]);

		const { status, body } = await request(PORT, "GET", "/sessions");
		expect(status).toBe(200);
		expect(store.queryNodes).toHaveBeenCalledWith("Session");
		expect((body as Record<string, unknown>).sessions).toEqual([
			expect.objectContaining({
				"@id": "urn:sovereign:session:v1:abc",
				name: "alpha",
			}),
		]);
	});

	// THE STORE'S ORDER IS THE ANSWER (ISS-044). This test used to feed [older, newer] and expect
	// `newer` — pinning a `.sort(created_at DESC)` in the transport. That re-sort is harmless only
	// while the store is an in-memory Map where a Session is never upserted; `index.ts` says it
	// becomes storage-sqlite in Phase 2, where the store answers in updated_at order and a
	// created_at re-sort silently returns the wrong N.
	//
	// So the rows now arrive in the order a store would give them, and the transport takes the
	// FRONT N without touching it.
	it("GET /sessions takes the front N of the store's own order", async () => {
		store.queryNodes.mockResolvedValueOnce([
			{
				"@type": "Session",
				"@id": "urn:sovereign:session:v1:newer",
				name: "newer",
				created_at_ns: 2,
			},
			{
				"@type": "Session",
				"@id": "urn:sovereign:session:v1:older",
				name: "older",
				created_at_ns: 1,
			},
		]);

		const { status, body } = await request(PORT, "GET", "/sessions?limit=1");
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).sessions).toEqual([
			expect.objectContaining({
				"@id": "urn:sovereign:session:v1:newer",
			}),
		]);
	});

	// THE CASE THAT DISTINGUISHES THE TWO, and which no test had: a store order that DISAGREES
	// with created_at. A transport that re-sorts returns "b" here; one that trusts the store
	// returns "a". Under an in-memory Map the two are indistinguishable, which is exactly why the
	// re-sort survived — and why this case has to be written rather than waited for.
	it("does not re-sort: a store order that disagrees with created_at is preserved", async () => {
		store.queryNodes.mockResolvedValueOnce([
			{
				"@type": "Session",
				"@id": "urn:sovereign:session:v1:a",
				name: "a",
				created_at_ns: 1,
			},
			{
				"@type": "Session",
				"@id": "urn:sovereign:session:v1:b",
				name: "b",
				created_at_ns: 999,
			},
		]);

		const { body } = await request(PORT, "GET", "/sessions?limit=1");
		expect((body as Record<string, unknown>).sessions).toEqual([
			expect.objectContaining({ "@id": "urn:sovereign:session:v1:a" }),
		]);
	});

	it("GET /sessions rejects invalid list limits", async () => {
		const { status, body } = await request(PORT, "GET", "/sessions?limit=0");
		expect(status).toBe(400);
		expect((body as Record<string, unknown>).error).toBe("invalid limit");
		expect(store.queryNodes).not.toHaveBeenCalled();
	});

	it("POST /sessions creates and stores a session node", async () => {
		store.storeNode.mockResolvedValueOnce(undefined);

		const { status, body } = await request(PORT, "POST", "/sessions", {
			name: "auth-refactor",
		});
		expect(status).toBe(200);
		const session = (body as Record<string, unknown>).session as
			| Record<string, unknown>
			| undefined;
		expect(session?.name).toBe("auth-refactor");
		expect(session?.["@id"]).toMatch(/^urn:sovereign:session:v1:[a-f0-9]+$/);
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
