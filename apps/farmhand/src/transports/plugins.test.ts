import crypto from "node:crypto";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSidecar } from "./http.js";
import { createPluginsRouteHandler } from "./plugins.js";
import { PluginUsageTracker } from "../plugin-usage-tracker.js";

vi.mock("../installed-plugins.js", () => ({
	loadInstalledPlugins: vi.fn().mockResolvedValue({ loaded: 1, skipped: 0 }),
	listInstalledPluginIds: vi.fn().mockReturnValue(["plugin-a"]),
}));

import { loadInstalledPlugins, listInstalledPluginIds } from "../installed-plugins.js";

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
		plugins: { load: vi.fn().mockResolvedValue(undefined) },
	};
}

function makeTracker(idle = true) {
	const tracker = new PluginUsageTracker();
	if (!idle) {
		tracker.registerEffort("e1", ["plugin-a"]);
	}
	return tracker;
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
				headers: payload
					? {
							"content-type": "application/json",
							"content-length": Buffer.byteLength(payload),
						}
					: {},
				agent: false,
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body: JSON.parse(data || "null") }),
				);
			},
		);
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});
}

describe("createPluginsRouteHandler", () => {
	let sidecar: HttpSidecar;
	let port: number;
	let target: ReturnType<typeof makeTarget>;
	let tracker: PluginUsageTracker;

	async function startSidecar(idle = true) {
		target = makeTarget();
		tracker = makeTracker(idle);
		sidecar = new HttpSidecar(0, makeAdapter());
		sidecar.addRouteHandler(createPluginsRouteHandler(target, "/tmp/test-refarm", tracker));
		await sidecar.start();
		const addr = sidecar.httpServer.address();
		port = typeof addr === "object" && addr !== null ? addr.port : 0;
	}

	afterEach(async () => {
		await sidecar.stop();
		vi.clearAllMocks();
		// Reset mock queues and re-establish base return values
		vi.mocked(loadInstalledPlugins).mockReset().mockResolvedValue({ loaded: 1, skipped: 0 });
		vi.mocked(listInstalledPluginIds).mockReset().mockReturnValue(["plugin-a"]);
	});

	describe("POST /plugins/reload — immediate (plugin idle)", () => {
		beforeEach(() => startSidecar(true));

		it("returns 200 with reloadId, reloaded[], empty deferred[]", async () => {
			const res = await request(port, "POST", "/plugins/reload");
			expect(res.status).toBe(200);
			const body = res.body as {
				reloadId: string;
				reloaded: string[];
				deferred: string[];
				skipped: string[];
			};
			expect(typeof body.reloadId).toBe("string");
			expect(body.reloaded).toContain("plugin-a");
			expect(body.deferred).toEqual([]);
		});

		it("calls loadInstalledPlugins with pluginFilter for the plugin", async () => {
			await request(port, "POST", "/plugins/reload");
			expect(loadInstalledPlugins).toHaveBeenCalledWith(
				target,
				"/tmp/test-refarm",
				{ pluginFilter: ["plugin-a"] },
			);
		});

		it("uses pluginIds from request body when provided", async () => {
			vi.mocked(listInstalledPluginIds).mockReturnValueOnce(["plugin-a", "plugin-b"]);
			const res = await request(port, "POST", "/plugins/reload", { pluginIds: ["plugin-a"] });
			expect(res.status).toBe(200);
			const body = res.body as { reloaded: string[] };
			expect(body.reloaded).toEqual(["plugin-a"]);
			expect(listInstalledPluginIds).not.toHaveBeenCalled();
		});

		it("returns 405 for GET /plugins/reload", async () => {
			const res = await request(port, "GET", "/plugins/reload");
			expect(res.status).toBe(405);
		});
	});

	describe("POST /plugins/reload — deferred (plugin busy)", () => {
		beforeEach(() => startSidecar(false));

		it("returns deferred[] when plugin has in-flight effort", async () => {
			const res = await request(port, "POST", "/plugins/reload");
			expect(res.status).toBe(200);
			const body = res.body as { reloaded: string[]; deferred: string[] };
			expect(body.reloaded).toEqual([]);
			expect(body.deferred).toContain("plugin-a");
		});

		it("executes reload when tracker fires idle and updates status", async () => {
			const res = await request(port, "POST", "/plugins/reload");
			const { reloadId } = res.body as { reloadId: string };

			const beforeIdle = await request(
				port,
				"GET",
				`/plugins/reload/status/${reloadId}`,
			);
			expect((beforeIdle.body as { pending: string[] }).pending).toContain("plugin-a");

			tracker.releaseEffort("e1");
			await new Promise((r) => setTimeout(r, 50));

			const afterIdle = await request(
				port,
				"GET",
				`/plugins/reload/status/${reloadId}`,
			);
			const afterBody = afterIdle.body as { pending: string[]; completed: string[] };
			expect(afterBody.pending).toEqual([]);
			expect(afterBody.completed).toContain("plugin-a");
		});
	});

	describe("GET /plugins/reload/status/:reloadId", () => {
		beforeEach(() => startSidecar(true));

		it("returns 404 for an unknown reloadId", async () => {
			const res = await request(
				port,
				"GET",
				`/plugins/reload/status/${crypto.randomUUID()}`,
			);
			expect(res.status).toBe(404);
			expect(res.body).toEqual({ error: "not found" });
		});

		it("does not intercept unrelated routes", async () => {
			const res = await request(port, "GET", "/efforts");
			expect(res.status).toBe(200);
		});
	});
});
