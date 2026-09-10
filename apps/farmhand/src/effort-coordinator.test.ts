import type {
	Effort,
	EffortLogEntry,
	EffortResult,
} from "@refarm.dev/effort-contract-v1";
import { describe, expect, it, vi } from "vitest";
import { EffortCoordinator } from "./effort-coordinator.js";
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

function makeEffort(): Effort {
	return {
		id: "effort-1",
		direction: "Prove neutral operations",
		tasks: [{ id: "task-1", pluginId: "plugin-1", fn: "run", args: {} }],
		source: "test",
		submittedAt: "2026-08-08T12:00:00.000Z",
	};
}

describe("EffortCoordinator", () => {
	it("coordinates submit, query, and cancellation without filesystem ingress", async () => {
		const repository = new MemoryEffortRepository();
		const executor = vi.fn();
		const coordinator = new EffortCoordinator(repository, executor);

		await expect(coordinator.submit(makeEffort())).resolves.toBe("effort-1");
		await expect(coordinator.query("effort-1")).resolves.toMatchObject({ status: "pending" });
		await expect(coordinator.cancel("effort-1")).resolves.toBe(true);
		await expect(coordinator.query("effort-1")).resolves.toMatchObject({
			status: "cancelled",
		});
		expect(repository.readLogs("effort-1")?.map((entry) => entry.event)).toEqual([
			"submitted",
			"cancel_requested",
		]);
		expect(executor).not.toHaveBeenCalled();
	});

	it("rejects cancellation for terminal work", async () => {
		const repository = new MemoryEffortRepository();
		const coordinator = new EffortCoordinator(repository, vi.fn());
		await coordinator.submit(makeEffort());
		await coordinator.cancel("effort-1");

		await expect(coordinator.cancel("effort-1")).resolves.toBe(false);
	});
});
