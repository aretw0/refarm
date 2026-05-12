import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSidecar } from "./http.js";
import { createPluginsRouteHandler } from "./plugins.js";

vi.mock("../installed-plugins.js", () => ({
	loadInstalledPlugins: vi
		.fn()
		.mockResolvedValue({ loaded: 2, skipped: 0 }),
}));

import { loadInstalledPlugins } from "../installed-plugins.js";

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

function makeTarget() {
	return {
		registry: {
			register: vi.fn().mockResolvedValue(undefined),
			trust: vi.fn().mockResolvedValue(undefined),
		},
		plugins: {
			load: vi.fn().mockResolvedValue(undefined),
		},
	};
}

async function request(
	port: number,
	method: string,
	path: string,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				method,
				path,
				agent: false,
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
		req.end();
	});
}

describe("createPluginsRouteHandler", () => {
	let sidecar: HttpSidecar;
	let port: number;

	beforeEach(async () => {
		const adapter = makeAdapter();
		const target = makeTarget();
		sidecar = new HttpSidecar(0, adapter);
		sidecar.addRouteHandler(createPluginsRouteHandler(target, "/tmp/test-refarm"));
		await sidecar.start();
		port = (sidecar.httpServer.address() as { port: number }).port;
	});

	afterEach(async () => {
		await sidecar.stop();
		vi.clearAllMocks();
	});

	it("POST /plugins/reload calls loadInstalledPlugins and returns counts", async () => {
		const res = await request(port, "POST", "/plugins/reload");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ reloaded: 2, skipped: 0 });
		expect(loadInstalledPlugins).toHaveBeenCalledWith(
			expect.objectContaining({ registry: expect.any(Object), plugins: expect.any(Object) }),
			"/tmp/test-refarm",
		);
	});

	it("GET /plugins/reload returns 405 method not allowed", async () => {
		const res = await request(port, "GET", "/plugins/reload");
		expect(res.status).toBe(405);
		expect(res.body).toEqual({ error: "method not allowed" });
	});

	it("does not intercept unrelated routes", async () => {
		const res = await request(port, "GET", "/efforts");
		expect(res.status).toBe(200);
	});
});
