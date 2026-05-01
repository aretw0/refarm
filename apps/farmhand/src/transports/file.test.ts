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
		executor.mockRejectedValueOnce(new Error("kaboom"));
		const effort = makeEffort();
		await adapter.process(effort);

		const result = await adapter.query("e1");
		expect(result!.results[0].status).toBe("error");
		expect(result!.results[0].error).toBe("kaboom");
		expect(result!.status).toBe("failed");
	});
});
