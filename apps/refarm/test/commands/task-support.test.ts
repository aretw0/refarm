import {
	EffortLogEntry,
	EffortResult,
	EffortSummary,
} from "@refarm.dev/effort-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSidecarUrl } from "../../src/commands/sidecar-url.js";
import {
	parseTaskTransport,
	resolveAdapter,
} from "../../src/commands/task-support.js";

function mockJsonResponse<T>(payload: T, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("task transport parser", () => {
	it("accepts channel transports", () => {
		expect(parseTaskTransport("channel:matrix")).toBe("channel:matrix");
		expect(parseTaskTransport("channel:matrix-ui")).toBe("channel:matrix-ui");
		expect(() => parseTaskTransport("channel:")).toThrow(
			'Invalid task transport "channel:". Use: file, http, channel:<name>',
		);
	});
});

describe("channel http transport adapter", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("targets channel control endpoints for submit/query/logs/retry/cancel", async () => {
		const baseUrl = resolveSidecarUrl();
		const adapter = resolveAdapter("channel:matrix");
		const submittedAt = new Date().toISOString();
		fetchSpy.mockResolvedValueOnce(mockJsonResponse({ effortId: "effort-1" }));
		fetchSpy.mockResolvedValueOnce(
			mockJsonResponse({
				effortId: "effort-1",
				status: "done",
				results: [],
				submittedAt,
			} satisfies EffortResult),
		);
		fetchSpy.mockResolvedValueOnce(
			mockJsonResponse([
				{
					effortId: "effort-1",
					timestamp: new Date().toISOString(),
					level: "info",
					event: "processing_finished",
					message: "done",
				},
			] satisfies EffortLogEntry[]),
		);
		fetchSpy.mockResolvedValueOnce(mockJsonResponse({ accepted: true }));
		fetchSpy.mockResolvedValueOnce(mockJsonResponse({ accepted: true }));
		fetchSpy.mockResolvedValueOnce(
			mockJsonResponse({
				total: 0,
				pending: 0,
				inProgress: 0,
				done: 0,
				partial: 0,
				failed: 0,
				timedOut: 0,
				cancelled: 0,
			} satisfies EffortSummary),
		);
		fetchSpy.mockResolvedValueOnce(mockJsonResponse([] as EffortResult[]));

		await adapter.submit({
			id: "effort-1",
			direction: "matrix prompt",
			tasks: [{ id: "task-1", pluginId: "runtime", fn: "respond", args: {} }],
			submittedAt,
		});
		await adapter.query("effort-1");
		await adapter.logs("effort-1");
		await adapter.retry("effort-1");
		await adapter.cancel("effort-1");
		await adapter.summary();
		await adapter.list();

		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			`${baseUrl}/channels/matrix/efforts`,
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchSpy.mock.calls[1]?.[0]).toBe(
			`${baseUrl}/channels/matrix/efforts/effort-1/status`,
		);
		expect(fetchSpy.mock.calls[2]?.[0]).toBe(
			`${baseUrl}/channels/matrix/efforts/effort-1/logs`,
		);
		expect(fetchSpy.mock.calls[3]?.[0]).toBe(
			`${baseUrl}/channels/matrix/efforts/effort-1/retry`,
		);
		expect(fetchSpy.mock.calls[4]?.[0]).toBe(
			`${baseUrl}/channels/matrix/efforts/effort-1/cancel`,
		);
		expect(fetchSpy.mock.calls[5]?.[0]).toBe(`${baseUrl}/efforts/summary`);
		expect(fetchSpy.mock.calls[6]?.[0]).toBe(`${baseUrl}/efforts`);
	});

	it("targets encoded channel names via shared control-surface path builders", async () => {
		const baseUrl = resolveSidecarUrl();
		const adapter = resolveAdapter("channel:matrix team");
		const submittedAt = new Date().toISOString();
		fetchSpy.mockResolvedValueOnce(mockJsonResponse({ effortId: "effort-1" }));
		fetchSpy.mockResolvedValueOnce(
			mockJsonResponse({
				effortId: "effort-1",
				status: "done",
				results: [],
			} satisfies EffortResult),
		);
		fetchSpy.mockResolvedValueOnce(mockJsonResponse([] as EffortLogEntry[]));
		fetchSpy.mockResolvedValueOnce(mockJsonResponse({ accepted: true }));
		fetchSpy.mockResolvedValueOnce(mockJsonResponse({ accepted: true }));
		fetchSpy.mockResolvedValueOnce(
			mockJsonResponse({
				total: 0,
				pending: 0,
				inProgress: 0,
				done: 0,
				partial: 0,
				failed: 0,
				timedOut: 0,
				cancelled: 0,
			} satisfies EffortSummary),
		);
		fetchSpy.mockResolvedValueOnce(mockJsonResponse([] as EffortResult[]));

		await adapter.submit({
			id: "effort-1",
			direction: "matrix prompt",
			tasks: [{ id: "task-1", pluginId: "runtime", fn: "respond", args: {} }],
			submittedAt,
		});
		await adapter.query("effort-1");
		await adapter.logs("effort-1");
		await adapter.retry("effort-1");
		await adapter.cancel("effort-1");
		await adapter.summary();
		await adapter.list();

		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			`${baseUrl}/channels/${encodeURIComponent("matrix team")}/efforts`,
			expect.objectContaining({ method: "POST" }),
		);
	});
});
