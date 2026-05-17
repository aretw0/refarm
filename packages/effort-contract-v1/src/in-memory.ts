import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortTransportAdapter,
	TaskResult,
} from "./types.js";

export interface InMemoryEffortOptions {
	/** How submitted efforts are resolved. Default: "done" */
	resolve?: "done" | "failed";
}

export function createInMemoryEffortAdapter(
	opts: InMemoryEffortOptions = {},
): EffortTransportAdapter {
	const results = new Map<string, EffortResult>();
	const logStore = new Map<string, EffortLogEntry[]>();
	const effortStore = new Map<string, Effort>();

	function log(
		effortId: string,
		event: EffortLogEntry["event"],
		message: string,
		taskId?: string,
	): void {
		const entries = logStore.get(effortId) ?? [];
		entries.push({
			effortId,
			timestamp: new Date().toISOString(),
			level: "info",
			event,
			message,
			taskId,
		});
		logStore.set(effortId, entries);
	}

	function buildResult(effort: Effort, targetStatus: "done" | "failed"): EffortResult {
		const now = new Date().toISOString();
		const taskResults: TaskResult[] = effort.tasks.map((t) => ({
			taskId: t.id,
			effortId: effort.id,
			status: targetStatus === "done" ? "ok" : "error",
			result: targetStatus === "done" ? null : undefined,
			error:
				targetStatus === "failed"
					? "in-memory adapter resolved effort as failed"
					: undefined,
			attempts: 1,
			startedAt: now,
			completedAt: now,
		}));

		return {
			effortId: effort.id,
			status: targetStatus,
			results: taskResults,
			submittedAt: effort.submittedAt,
			startedAt: now,
			attemptCount: 1,
			lastUpdatedAt: now,
			completedAt: now,
		};
	}

	return {
		async submit(effort: Effort): Promise<string> {
			effortStore.set(effort.id, effort);
			log(effort.id, "submitted", `Effort ${effort.id} submitted`);
			log(effort.id, "processing_started", "Processing started");

			const targetStatus = opts.resolve ?? "done";
			for (const task of effort.tasks) {
				log(effort.id, "task_attempt_started", `Task ${task.id} started`, task.id);
				const taskEvent =
					targetStatus === "done" ? "task_attempt_succeeded" : "task_attempt_failed";
				log(effort.id, taskEvent, `Task ${task.id} ${targetStatus}`, task.id);
			}
			log(effort.id, "processing_finished", `Processing finished as ${targetStatus}`);

			results.set(effort.id, buildResult(effort, targetStatus));
			return effort.id;
		},

		async query(effortId: string): Promise<EffortResult | null> {
			return results.get(effortId) ?? null;
		},

		async list(): Promise<EffortResult[]> {
			return Array.from(results.values());
		},

		async logs(effortId: string): Promise<EffortLogEntry[] | null> {
			return logStore.get(effortId) ?? null;
		},

		async cancel(effortId: string): Promise<boolean> {
			const result = results.get(effortId);
			if (!result || result.status === "done" || result.status === "cancelled") {
				return false;
			}
			result.status = "cancelled";
			result.lastUpdatedAt = new Date().toISOString();
			log(effortId, "cancel_requested", "Effort cancelled");
			return true;
		},

		async retry(effortId: string): Promise<boolean> {
			const effort = effortStore.get(effortId);
			if (!effort) return false;
			log(effortId, "retry_requested", "Retry requested");
			const targetStatus = opts.resolve ?? "done";
			results.set(effortId, buildResult(effort, targetStatus));
			return true;
		},

		async summary() {
			const all = Array.from(results.values());
			return {
				total: all.length,
				pending: all.filter((r) => r.status === "pending").length,
				inProgress: all.filter((r) => r.status === "in-progress").length,
				done: all.filter((r) => r.status === "done").length,
				failed: all.filter((r) => r.status === "failed").length,
				cancelled: all.filter((r) => r.status === "cancelled").length,
			};
		},
	};
}
