import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTransportAdapter, type TaskExecutorFn } from "./file.js";

const TEST_BASE = path.join(os.tmpdir(), `refarm-test-${Date.now()}`);

function makeEffort(overrides: Partial<Effort> = {}): Effort {
	return {
		id: "e1",
		direction: "Test effort",
		tasks: [{ id: "t1", pluginId: "p", fn: "f", args: {} }],
		source: "test",
		submittedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("FileTransportAdapter", () => {
	let adapter: FileTransportAdapter;
	let executor: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		executor = vi.fn().mockResolvedValue({
			status: "ok",
			result: 42,
		});
		adapter = new FileTransportAdapter(
			TEST_BASE,
			executor as unknown as TaskExecutorFn,
		);
	});

	afterEach(() => {
		fs.rmSync(TEST_BASE, { recursive: true, force: true });
	});

	it("submit() writes effort file to tasksDir", async () => {
		const effort = makeEffort();
		await adapter.submit(effort);

		const taskFile = path.join(TEST_BASE, "tasks", `${effort.id}.json`);
		expect(fs.existsSync(taskFile)).toBe(true);
		const parsed = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
		expect(parsed.id).toBe("e1");
	});

	it("query() returns null for unknown effortId", async () => {
		const result = await adapter.query("unknown-id");
		expect(result).toBeNull();
	});

	it("query() returns EffortResult after process() writes result", async () => {
		const effort = makeEffort();
		await adapter.process(effort);

		const result = await adapter.query("e1");
		expect(result).not.toBeNull();
		expect(result!.effortId).toBe("e1");
		expect(result!.status).toBe("done");
		expect(result!.results).toHaveLength(1);
		expect(result!.results[0].status).toBe("ok");
	});

	it("process() calls executor for each task", async () => {
		const effort = makeEffort({
			tasks: [
				{ id: "t1", pluginId: "p", fn: "f", args: {} },
				{ id: "t2", pluginId: "p", fn: "g", args: {} },
			],
		});

		await adapter.process(effort);
		expect(executor).toHaveBeenCalledTimes(2);
	});

	it("process() marks EffortResult as failed when executor throws", async () => {
		executor.mockRejectedValue(new Error("kaboom"));
		const effort = makeEffort();
		await adapter.process(effort);

		const result = await adapter.query("e1");
		expect(result!.results[0].status).toBe("error");
		expect(result!.results[0].error).toBe("kaboom");
		expect(result!.status).toBe("failed");
	});

	it("retry() reprocesses a failed effort", async () => {
		executor.mockRejectedValueOnce(new Error("first fail"));
		const effort = makeEffort();
		await adapter.submit(effort);
		await adapter.process(effort);

		executor.mockResolvedValueOnce({ status: "ok", result: "recovered" });
		const accepted = await adapter.retry("e1");
		expect(accepted).toBe(true);

		const stop = adapter.watch();
		await new Promise((resolve) => setTimeout(resolve, 120));
		stop();

		const result = await adapter.query("e1");
		expect(result?.status).toBe("done");
	});

	it("cancel() marks effort as cancelled", async () => {
		const effort = makeEffort();
		await adapter.submit(effort);
		const accepted = await adapter.cancel("e1");
		expect(accepted).toBe(true);

		const result = await adapter.query("e1");
		expect(result?.status).toBe("cancelled");
	});

	it("logs() returns journal entries", async () => {
		const effort = makeEffort();
		await adapter.submit(effort);
		await adapter.process(effort);

		const logs = await adapter.logs("e1");
		expect(logs).not.toBeNull();
		expect(logs!.length).toBeGreaterThan(0);
		expect(logs![0].event).toBe("submitted");
	});

	it("summary() aggregates by status", async () => {
		const doneEffort = makeEffort({ id: "done-e", tasks: [] });
		const pendingEffort = makeEffort({ id: "pending-e", tasks: [] });

		await adapter.submit(doneEffort);
		await adapter.process(doneEffort);
		await adapter.submit(pendingEffort);

		const summary = await adapter.summary();
		expect(summary.total).toBeGreaterThanOrEqual(2);
		expect(summary.done).toBeGreaterThanOrEqual(1);
		expect(summary.pending).toBeGreaterThanOrEqual(1);
	});

	it("visibilityWindow() reports recent status and failure rate", async () => {
		const resultsDir = path.join(TEST_BASE, "task-results");
		const now = Date.now();
		const recent = new Date(now - 5 * 60_000).toISOString();
		const stale = new Date(now - 2 * 60 * 60_000).toISOString();

		fs.writeFileSync(
			path.join(resultsDir, "recent-failed.json"),
			JSON.stringify({
				effortId: "recent-failed",
				status: "failed",
				results: [],
				completedAt: recent,
			}),
			"utf-8",
		);
		fs.writeFileSync(
			path.join(resultsDir, "stale-done.json"),
			JSON.stringify({
				effortId: "stale-done",
				status: "done",
				results: [],
				completedAt: stale,
			}),
			"utf-8",
		);

		const window = await adapter.visibilityWindow(30);
		expect(window.windowMinutes).toBe(30);
		expect(window.total).toBe(1);
		expect(window.failed).toBe(1);
		expect(window.done).toBe(0);
		expect(window.terminal).toBe(1);
		expect(window.failureRatePct).toBe(100);
	});
});
