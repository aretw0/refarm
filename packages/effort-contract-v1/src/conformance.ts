import type {
	Effort,
	EffortConformanceResult,
	EffortTransportAdapter,
} from "./types.js";
import { EFFORT_TERMINAL_STATES } from "./types.js";

function nowIso(): string {
	return new Date().toISOString();
}

function makeEffort(overrides: Partial<Effort> = {}): Effort {
	const ts = Date.now();
	return {
		id: `conformance-${ts}`,
		direction: "Conformance test effort",
		tasks: [
			{ id: `task-a-${ts}`, pluginId: "test-plugin", fn: "noop", args: {} },
			{ id: `task-b-${ts}`, pluginId: "test-plugin", fn: "noop", args: {} },
		],
		source: "conformance",
		submittedAt: nowIso(),
		...overrides,
	};
}

export async function runEffortV1Conformance(
	adapter: EffortTransportAdapter,
): Promise<EffortConformanceResult> {
	const failures: string[] = [];

	function check(label: string, condition: boolean): void {
		if (!condition) failures.push(label);
	}

	const effort = makeEffort();
	let effortId: string;

	// 1. submit() returns a non-empty string
	try {
		effortId = await adapter.submit(effort);
		check("submit() returns non-empty string", typeof effortId === "string" && effortId.length > 0);
	} catch (e) {
		failures.push(`submit() threw: ${String(e)}`);
		return { pass: false, total: 13, failed: failures.length, failures };
	}

	// 2. query(unknown) returns null
	try {
		const unknown = await adapter.query("__nonexistent__");
		check("query(unknown) returns null", unknown === null);
	} catch (e) {
		failures.push(`query(unknown) threw: ${String(e)}`);
	}

	// 3–6. query(submitted) returns EffortResult with correct shape
	try {
		const result = await adapter.query(effortId);
		check("query(submitted) returns non-null", result !== null);
		if (result !== null) {
			check("query() effortId matches", result.effortId === effortId);
			check(
				"query() status is a known EffortStatus",
				["pending", "in-progress", "done", "partial", "failed", "timed-out", "cancelled"].includes(
					result.status,
				),
			);
			check("query() results is array", Array.isArray(result.results));

			// 6b. task result statuses are valid
			const validTaskStatuses = new Set(["ok", "error", "timeout", "skipped", "cancelled"]);
			const invalidTaskStatus = result.results.find((r) => !validTaskStatuses.has(r.status));
			check(
				"all task result statuses are valid",
				invalidTaskStatus === undefined,
			);
		}
	} catch (e) {
		failures.push(`query(submitted) threw: ${String(e)}`);
	}

	// 7. list() includes submitted effort
	if (adapter.list) {
		try {
			const all = await adapter.list();
			check("list() contains submitted effort", all.some((r) => r.effortId === effortId));
		} catch (e) {
			failures.push(`list() threw: ${String(e)}`);
		}
	}

	// 8. logs() returns array or null
	if (adapter.logs) {
		try {
			const logs = await adapter.logs(effortId);
			check("logs() returns array or null", logs === null || Array.isArray(logs));
		} catch (e) {
			failures.push(`logs() threw: ${String(e)}`);
		}
	}

	// 9. cancel() on a non-terminal effort returns boolean
	if (adapter.cancel) {
		const cancelEffort = makeEffort({ id: `conformance-cancel-${Date.now()}` });
		try {
			const cancelId = await adapter.submit(cancelEffort);
			const cancelled = await adapter.cancel(cancelId);
			check("cancel() returns boolean", typeof cancelled === "boolean");
			// If the effort was already terminal, cancel() returning false is correct
			const afterCancel = await adapter.query(cancelId);
			if (afterCancel && !EFFORT_TERMINAL_STATES.has(afterCancel.status)) {
				// cancel() returned true — verify the status updated
				if (cancelled) {
					check("cancel() transitions status to cancelled", afterCancel.status === "cancelled");
				}
			}
		} catch (e) {
			failures.push(`cancel() threw: ${String(e)}`);
		}
	}

	// 10. retry() returns boolean
	if (adapter.retry) {
		try {
			const retried = await adapter.retry(effortId);
			check("retry() returns boolean", typeof retried === "boolean");
		} catch (e) {
			failures.push(`retry() threw: ${String(e)}`);
		}
	}

	// 11–12. summary() returns all expected numeric fields
	if (adapter.summary) {
		try {
			const summary = await adapter.summary();
			check("summary() total >= 1", summary.total >= 1);
			check(
				"summary() has all status count fields",
				typeof summary.pending === "number" &&
				typeof summary.inProgress === "number" &&
				typeof summary.done === "number" &&
				typeof summary.partial === "number" &&
				typeof summary.failed === "number" &&
				typeof summary.timedOut === "number" &&
				typeof summary.cancelled === "number",
			);
		} catch (e) {
			failures.push(`summary() threw: ${String(e)}`);
		}
	}

	const failed = failures.length;
	return { pass: failed === 0, total: 13, failed, failures };
}
