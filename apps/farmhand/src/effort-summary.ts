import type {
	EffortResult,
	EffortStatus,
	EffortSummary,
} from "@refarm.dev/effort-contract-v1";
import type { PressureWindow } from "@refarm.dev/pressure-contract-v1";

function emptySummary(total = 0): EffortSummary {
	return {
		total,
		pending: 0,
		inProgress: 0,
		done: 0,
		delivered: 0,
		partial: 0,
		failed: 0,
		timedOut: 0,
		cancelled: 0,
	};
}

function incrementStatus(summary: EffortSummary, status: EffortStatus): void {
	switch (status) {
		case "pending":
			summary.pending += 1;
			break;
		case "in-progress":
			summary.inProgress += 1;
			break;
		case "done":
			summary.done += 1;
			break;
		case "delivered":
			summary.delivered += 1;
			break;
		case "partial":
			summary.partial += 1;
			break;
		case "failed":
			summary.failed += 1;
			break;
		case "timed-out":
			summary.timedOut += 1;
			break;
		case "cancelled":
			summary.cancelled += 1;
			break;
	}
}

/** Aggregate persisted effort results without transport or clock dependencies. */
export function summarizeEfforts(results: readonly EffortResult[]): EffortSummary {
	const summary = emptySummary(results.length);
	for (const result of results) incrementStatus(summary, result.status);
	return summary;
}

/** Build the pressure window with an explicit clock for deterministic callers and tests. */
export function summarizeEffortWindow(
	results: readonly EffortResult[],
	minutes: number,
	nowMs: number,
): PressureWindow {
	const windowMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 60;
	const cutoffMs = nowMs - windowMinutes * 60_000;
	const summary = emptySummary();

	for (const result of results) {
		const stamp = result.completedAt ?? result.startedAt ?? result.submittedAt;
		const stampMs = stamp ? Date.parse(stamp) : Number.NaN;
		if (!Number.isFinite(stampMs) || stampMs < cutoffMs) continue;

		summary.total += 1;
		incrementStatus(summary, result.status);
	}

	const terminal =
		summary.done +
		summary.delivered +
		summary.partial +
		summary.failed +
		summary.timedOut +
		summary.cancelled;
	const failureRatePct = terminal > 0 ? Number(((summary.failed / terminal) * 100).toFixed(2)) : null;

	return {
		...summary,
		windowMinutes,
		since: new Date(cutoffMs).toISOString(),
		terminal,
		failureRatePct,
		generatedAt: new Date(nowMs).toISOString(),
	};
}
