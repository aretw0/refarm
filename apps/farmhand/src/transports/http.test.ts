import {
	getRegisteredChannelControlSurface,
	removeChannelControlSurfaceAdapter,
	setChannelControlSurfaceAdapter,
} from "@refarm.dev/dispatch-surface";
import type { Effort, EffortResult } from "@refarm.dev/effort-contract-v1";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createControlSurfaceRouteHandler } from "./channels.js";
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
		telemetry: vi.fn().mockResolvedValue({
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
		telemetryWindow: vi.fn().mockResolvedValue({
			windowMinutes: 60,
			since: new Date(Date.now() - 60 * 60_000).toISOString(),
			terminal: 0,
			failureRatePct: null,
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

type MockChannelControlSurface = {
	id: string;
	capabilities: {
		submit: boolean;
		query: boolean;
		logs: boolean;
		summary: boolean;
		list: boolean;
		retry: boolean;
		cancel: boolean;
	};
	buildSubmitPath(...args: unknown[]): string;
	buildQueryPath(...args: unknown[]): string;
	buildLogsPath(...args: unknown[]): string;
	buildRetryPath(...args: unknown[]): string;
	buildCancelPath(...args: unknown[]): string;
	buildSummaryPath(...args: unknown[]): string;
	buildListPath(...args: unknown[]): string;
};

function controlSurfaceAdapter(
	capabilities: Partial<MockChannelControlSurface["capabilities"]> = {},
): MockChannelControlSurface {
	return {
		id: "test-channel-control",
		capabilities: {
			submit: true,
			query: true,
			logs: true,
			summary: true,
			list: true,
			retry: true,
			cancel: true,
			...capabilities,
		},
		buildSubmitPath: () => "",
		buildQueryPath: () => "",
		buildLogsPath: () => "",
		buildRetryPath: () => "",
		buildCancelPath: () => "",
		buildSummaryPath: () => "",
		buildListPath: () => "",
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

function withDisabledChannelCapabilities(
	disabledCapabilities: Partial<MockChannelControlSurface["capabilities"]> = {},
): () => void {
	const previous = getRegisteredChannelControlSurface("matrix");
	setChannelControlSurfaceAdapter(
		"matrix",
		controlSurfaceAdapter(disabledCapabilities),
	);
	return () => {
		if (previous) {
			setChannelControlSurfaceAdapter(previous.channel, previous.adapter);
			return;
		}
		removeChannelControlSurfaceAdapter("matrix");
	};
}

describe("HttpSidecar", () => {
	let sidecar: HttpSidecar;
	let adapter: ReturnType<typeof makeAdapter>;
	const PORT = 42099;

	beforeEach(async () => {
		adapter = makeAdapter();
		sidecar = new HttpSidecar(PORT, adapter);
		sidecar.addRouteHandler(createControlSurfaceRouteHandler(adapter));
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
		expect((body as Record<string, unknown>).effortId).toBe("e1");
		expect(adapter.submit).toHaveBeenCalled();
	});

	it("POST /channels/:channel/efforts injects channel metadata", async () => {
		const effort = {
			id: "matrix-effort",
			direction: "matrix prompt",
			tasks: [
				{
					id: "chat-task",
					pluginId: "agent",
					fn: "complete",
					args: { message: "ping" },
				},
			],
			context: { sourceHint: "bridge" },
			replyTo: "thread-1",
			traceIds: ["trace-1", "trace-2"],
			source: "matrix:bridge",
			submittedAt: new Date().toISOString(),
		} as unknown as Effort;
		adapter.submit.mockResolvedValue("e1");
		adapter.submit.mockClear();
		const { status, body } = await request(
			PORT,
			"POST",
			"/channels/matrix/efforts",
			effort,
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).effortId).toBe("e1");
		expect(adapter.submit).toHaveBeenCalledTimes(1);
		const submittedEffort = adapter.submit.mock.calls[0]?.[0] as Effort;
		expect(submittedEffort.source).toBe("matrix:bridge");
		expect(submittedEffort.context).toMatchObject({
			sourceHint: "bridge",
			channel: "matrix",
			replyTo: "thread-1",
			traceIds: ["trace-1", "trace-2"],
		});
	});

	it("POST /channels/:channel/efforts rejects invalid payloads", async () => {
		const { status, body } = await request(
			PORT,
			"POST",
			"/channels/matrix/efforts",
			{
				direction: "missing tasks",
			},
		);
		expect(status).toBe(400);
		expect((body as Record<string, unknown>).error).toBe(
			"invalid-effort-payload",
		);
		expect(adapter.submit).not.toHaveBeenCalled();
	});

	it("GET /channels/:channel/efforts/:id returns effort status", async () => {
		const mockResult: EffortResult = {
			effortId: "e1",
			status: "done",
			results: [],
			completedAt: new Date().toISOString(),
		};
		adapter.query.mockResolvedValueOnce(mockResult);

		const { status, body } = await request(
			PORT,
			"GET",
			"/channels/matrix/efforts/e1",
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).effortId).toBe("e1");
		expect(adapter.query).toHaveBeenCalledWith("e1");
	});

	it("GET /channels/:channel/efforts/:id/status returns effort status", async () => {
		const mockResult: EffortResult = {
			effortId: "e1",
			status: "done",
			results: [],
			completedAt: new Date().toISOString(),
		};
		adapter.query.mockResolvedValueOnce(mockResult);

		const { status, body } = await request(
			PORT,
			"GET",
			"/channels/matrix/efforts/e1/status",
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).effortId).toBe("e1");
		expect(adapter.query).toHaveBeenCalledWith("e1");
	});

	it("GET /channels/:channel/efforts/:id/status decodes encoded effort ids", async () => {
		const mockResult: EffortResult = {
			effortId: "e1/with/slash",
			status: "done",
			results: [],
			completedAt: new Date().toISOString(),
		};
		adapter.query.mockResolvedValueOnce(mockResult);

		const { status, body } = await request(
			PORT,
			"GET",
			"/channels/matrix/efforts/e1%2Fwith%2Fslash/status",
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).effortId).toBe("e1/with/slash");
		expect(adapter.query).toHaveBeenCalledWith("e1/with/slash");
	});

	it("GET /channels/:channel/efforts/:id/logs returns effort logs", async () => {
		adapter.logs.mockResolvedValueOnce([
			{
				effortId: "e1",
				timestamp: new Date().toISOString(),
				event: "processing_finished",
				level: "info",
				message: "done",
			},
		]);

		const { status, body } = await request(
			PORT,
			"GET",
			"/channels/matrix/efforts/e1/logs",
		);
		expect(status).toBe(200);
		expect(Array.isArray(body)).toBe(true);
		expect((body as Record<string, unknown>[])[0]?.effortId).toBe("e1");
	});

	it("GET /channels/:channel/efforts/:id/stream aliases to effort logs", async () => {
		adapter.logs.mockResolvedValueOnce([
			{
				effortId: "e1",
				timestamp: new Date().toISOString(),
				event: "processing_finished",
				level: "info",
				message: "done",
			},
		]);

		const { status, body } = await request(
			PORT,
			"GET",
			"/channels/matrix/efforts/e1/stream",
		);
		expect(status).toBe(200);
		expect(Array.isArray(body)).toBe(true);
		expect(adapter.logs).toHaveBeenCalledWith("e1");
	});

	it("GET /channels/:channel/efforts/:id/evidence aliases to effort logs", async () => {
		adapter.logs.mockResolvedValueOnce([
			{
				effortId: "e1",
				timestamp: new Date().toISOString(),
				event: "processing_finished",
				level: "info",
				message: "done",
			},
		]);

		const { status, body } = await request(
			PORT,
			"GET",
			"/channels/matrix/efforts/e1/evidence",
		);
		expect(status).toBe(200);
		expect(Array.isArray(body)).toBe(true);
		expect(adapter.logs).toHaveBeenCalledWith("e1");
	});

	it("POST /channels/:channel/efforts/:id/retry returns accepted", async () => {
		adapter.retry.mockResolvedValueOnce(true);
		const { status, body } = await request(
			PORT,
			"POST",
			"/channels/matrix/efforts/e1/retry",
		);
		expect(status).toBe(202);
		expect((body as Record<string, unknown>).accepted).toBe(true);
		expect(adapter.retry).toHaveBeenCalledWith("e1");
	});

	it("POST /channels/:channel/efforts/:id/retry is rejected when adapter disables retry", async () => {
		const restore = withDisabledChannelCapabilities({ retry: false });
		try {
			const { status, body } = await request(
				PORT,
				"POST",
				"/channels/matrix/efforts/e1/retry",
			);
			expect(status).toBe(405);
			expect((body as Record<string, unknown>).error).toBe(
				"channel operation unsupported",
			);
			expect(adapter.retry).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});

	it("GET /channels/:channel/efforts/:id returns 405 when query unsupported", async () => {
		const restore = withDisabledChannelCapabilities({ query: false });
		try {
			const { status, body } = await request(
				PORT,
				"GET",
				"/channels/matrix/efforts/e1/status",
			);
			expect(status).toBe(405);
			expect((body as Record<string, unknown>).error).toBe(
				"channel operation unsupported",
			);
			expect(adapter.query).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});

	it("POST /channels/:channel/efforts/:id/cancel returns accepted", async () => {
		adapter.cancel.mockResolvedValueOnce(true);
		const { status, body } = await request(
			PORT,
			"POST",
			"/channels/matrix/efforts/e1/cancel",
		);
		expect(status).toBe(202);
		expect((body as Record<string, unknown>).accepted).toBe(true);
		expect(adapter.cancel).toHaveBeenCalledWith("e1");
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
		expect((body as Record<string, unknown>).effortId).toBe("e1");
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
		expect((body as Record<string, unknown>).ok).toBe(true);
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
		expect((body as Record<string, unknown>[])[0]?.effortId).toBe("e1");
	});

	it("GET /telemetry returns runtime telemetry snapshot", async () => {
		const { status, body } = await request(PORT, "GET", "/telemetry");
		expect(status).toBe(200);
		expect(adapter.telemetry).toHaveBeenCalled();
		expect((body as Record<string, unknown>).queueDepth).toBe(0);
	});

	it("GET /telemetry/window returns rolling window summary", async () => {
		const { status, body } = await request(
			PORT,
			"GET",
			"/telemetry/window?minutes=15",
		);
		expect(status).toBe(200);
		expect(adapter.telemetryWindow).toHaveBeenCalledWith(15);
		expect((body as Record<string, unknown>).windowMinutes).toBe(60);
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
