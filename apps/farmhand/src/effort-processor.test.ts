import type {
	Effort,
	EffortLogEntry,
	EffortResult,
} from "@refarm.dev/effort-contract-v1";
import { describe, expect, it, vi } from "vitest";
import { EffortExecutionState } from "./effort-execution-state.js";
import { EffortProcessor } from "./effort-processor.js";
import type { EffortRepository } from "./effort-repository.js";

class MemoryEffortRepository implements EffortRepository {
	readonly efforts = new Map<string, Effort>();
	readonly results = new Map<string, EffortResult>();
	readonly logs = new Map<string, EffortLogEntry[]>();

	writeEffort(effort: Effort): void {
		this.efforts.set(effort.id, effort);
	}

	hasEffort(effortId: string): boolean {
		return this.efforts.has(effortId);
	}

	readEffort(effortId: string): Effort | null {
		return this.efforts.get(effortId) ?? null;
	}

	listResults(): EffortResult[] {
		return [...this.results.values()];
	}

	readResult(effortId: string): EffortResult | null {
		return this.results.get(effortId) ?? null;
	}

	writeResult(result: EffortResult): void {
		this.results.set(result.effortId, result);
	}

	readLogs(effortId: string): EffortLogEntry[] | null {
		return this.logs.get(effortId) ?? null;
	}

	appendLog(effortId: string, entry: EffortLogEntry): void {
		this.logs.set(effortId, [...(this.logs.get(effortId) ?? []), entry]);
	}
}

function makeEffort(overrides: Partial<Effort> = {}): Effort {
	return {
		id: "effort-1",
		direction: "Prove the processor boundary",
		tasks: [{ id: "task-1", pluginId: "plugin-1", fn: "run", args: {} }],
		source: "test",
		submittedAt: "2026-08-06T12:00:00.000Z",
		...overrides,
	};
}

describe("EffortProcessor", () => {
	it("executes lifecycle policy against an in-memory repository", async () => {
		const repository = new MemoryEffortRepository();
		const state = new EffortExecutionState();
		const onEffortStart = vi.fn();
		const onEffortEnd = vi.fn();
		const executor = vi.fn().mockResolvedValue({ status: "ok", result: 42 });
		const processor = new EffortProcessor(repository, state, executor, {
			onEffortStart,
			onEffortEnd,
		});

		await processor.process(makeEffort());

		expect(repository.readResult("effort-1")).toMatchObject({
			status: "done",
			attemptCount: 1,
			results: [{ taskId: "task-1", status: "ok", result: 42 }],
		});
		expect(repository.readLogs("effort-1")?.map((entry) => entry.event)).toEqual([
			"processing_started",
			"task_attempt_started",
			"task_attempt_succeeded",
			"processing_finished",
		]);
		expect(onEffortStart).toHaveBeenCalledWith("effort-1", ["plugin-1"]);
		expect(onEffortEnd).toHaveBeenCalledWith("effort-1");
		expect(state.inFlightCount).toBe(0);
	});

	it("applies retry policy without depending on the file transport", async () => {
		const repository = new MemoryEffortRepository();
		const executor = vi
			.fn()
			.mockResolvedValueOnce({ status: "error", error: "temporary" })
			.mockResolvedValueOnce({ status: "ok", result: "recovered" });
		const processor = new EffortProcessor(repository, new EffortExecutionState(), executor);

		await processor.process(makeEffort({ context: { maxAttempts: 2 } }));

		expect(executor).toHaveBeenCalledTimes(2);
		expect(repository.readResult("effort-1")).toMatchObject({
			status: "done",
			attemptCount: 2,
			results: [{ status: "ok", attempts: 2 }],
		});
	});

	it("honors cancellation state before invoking the executor", async () => {
		const repository = new MemoryEffortRepository();
		const state = new EffortExecutionState();
		const executor = vi.fn();
		state.requestCancellation("effort-1");
		const processor = new EffortProcessor(repository, state, executor);

		await processor.process(makeEffort());

		expect(executor).not.toHaveBeenCalled();
		expect(repository.readResult("effort-1")).toMatchObject({
			status: "cancelled",
			results: [{ status: "cancelled", attempts: 0 }],
		});
		expect(state.cancellationCount).toBe(0);
	});
});
