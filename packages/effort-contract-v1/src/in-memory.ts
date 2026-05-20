import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortStatus,
	EffortTransportAdapter,
	Task,
	TaskResult,
	TaskResultStatus,
} from "./types.js";
import { EFFORT_TERMINAL_STATES } from "./types.js";

export interface InMemoryEffortOptions {
	/**
	 * How submitted efforts are resolved.
	 * - "done"     — all tasks ok (default)
	 * - "partial"  — first half ok, second half error
	 * - "failed"   — all tasks error
	 * - "timed-out" — effort expires before finishing
	 */
	resolve?: "done" | "partial" | "failed" | "timed-out";
}

function nowIso(): string {
	return new Date().toISOString();
}

function deriveEffortStatus(taskResults: TaskResult[]): EffortStatus {
	if (taskResults.length === 0) return "failed";
	const okCount = taskResults.filter((r) => r.status === "ok").length;
	const failCount = taskResults.filter(
		(r) => r.status === "error" || r.status === "timeout",
	).length;
	if (okCount === taskResults.length) return "done";
	if (failCount === taskResults.length) return "failed";
	return "partial";
}

function buildTaskResults(
	tasks: Task[],
	effortId: string,
	resolve: "done" | "partial" | "failed" | "timed-out",
): TaskResult[] {
	const now = nowIso();

	if (resolve === "timed-out") {
		// First task gets "timeout", the rest are "skipped"
		return tasks.map((t, i) => ({
			taskId: t.id,
			effortId,
			status: (i === 0 ? "timeout" : "skipped") as TaskResultStatus,
			error: i === 0 ? "effort timed out during execution" : undefined,
			attempts: i === 0 ? 1 : 0,
			startedAt: i === 0 ? now : undefined,
			completedAt: now,
		}));
	}

	return tasks.map((t, i) => {
		let status: TaskResultStatus;
		if (resolve === "done") {
			status = "ok";
		} else if (resolve === "failed") {
			status = "error";
		} else {
			// partial: first half ok, second half error
			status = i < Math.ceil(tasks.length / 2) ? "ok" : "error";
		}
		return {
			taskId: t.id,
			effortId,
			status,
			result: status === "ok" ? null : undefined,
			error: status === "error" ? "in-memory adapter resolved task as failed" : undefined,
			attempts: 1,
			startedAt: now,
			completedAt: now,
		};
	});
}

export function createInMemoryEffortAdapter(
	opts: InMemoryEffortOptions = {},
): EffortTransportAdapter {
	const results = new Map<string, EffortResult>();
	const logStore = new Map<string, EffortLogEntry[]>();
	const effortStore = new Map<string, Effort>();

	const resolveAs = opts.resolve ?? "done";

	function log(
		effortId: string,
		level: EffortLogEntry["level"],
		event: EffortLogEntry["event"],
		message: string,
		taskId?: string,
	): void {
		const entries = logStore.get(effortId) ?? [];
		entries.push({ effortId, timestamp: nowIso(), level, event, message, taskId });
		logStore.set(effortId, entries);
	}

	function buildResult(effort: Effort): EffortResult {
		const now = nowIso();
		const taskResults = buildTaskResults(effort.tasks, effort.id, resolveAs);
		const status: EffortStatus =
			resolveAs === "timed-out" ? "timed-out" : deriveEffortStatus(taskResults);

		return {
			effortId: effort.id,
			status,
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
			log(effort.id, "info", "submitted", `Effort ${effort.id} submitted`);
			log(effort.id, "info", "processing_started", "Processing started");

			for (const task of effort.tasks) {
				log(effort.id, "info", "task_attempt_started", `Task ${task.id} started`, task.id);
			}

			const result = buildResult(effort);

			for (const tr of result.results) {
				if (tr.status === "ok") {
					log(effort.id, "info", "task_attempt_succeeded", `Task ${tr.taskId} succeeded`, tr.taskId);
				} else if (tr.status === "error") {
					log(effort.id, "warn", "task_attempt_failed", `Task ${tr.taskId} failed`, tr.taskId);
				} else if (tr.status === "timeout") {
					log(effort.id, "warn", "task_attempt_timed_out", `Task ${tr.taskId} timed out`, tr.taskId);
				} else if (tr.status === "skipped") {
					log(effort.id, "info", "task_skipped", `Task ${tr.taskId} skipped`, tr.taskId);
				}
			}

			if (result.status === "timed-out") {
				log(effort.id, "warn", "timed_out", "Effort timed out");
			}
			log(effort.id, "info", "processing_finished", `Processing finished as ${result.status}`);

			results.set(effort.id, result);
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
			if (!result || EFFORT_TERMINAL_STATES.has(result.status)) return false;
			result.status = "cancelled";
			result.lastUpdatedAt = nowIso();
			log(effortId, "info", "cancel_requested", "Effort cancelled");
			return true;
		},

		async retry(effortId: string): Promise<boolean> {
			const effort = effortStore.get(effortId);
			if (!effort) return false;
			// cancelled is terminal — cannot retry
			const current = results.get(effortId);
			if (current?.status === "cancelled") return false;
			log(effortId, "info", "retry_requested", "Retry requested");
			const rebuilt = buildResult(effort);
			rebuilt.attemptCount = (current?.attemptCount ?? 0) + 1;
			results.set(effortId, rebuilt);
			return true;
		},

		async summary() {
			const all = Array.from(results.values());
			return {
				total: all.length,
				pending: all.filter((r) => r.status === "pending").length,
				inProgress: all.filter((r) => r.status === "in-progress").length,
				done: all.filter((r) => r.status === "done").length,
				partial: all.filter((r) => r.status === "partial").length,
				failed: all.filter((r) => r.status === "failed").length,
				timedOut: all.filter((r) => r.status === "timed-out").length,
				cancelled: all.filter((r) => r.status === "cancelled").length,
			};
		},
	};
}
