export const EFFORT_CAPABILITY = "effort:v1" as const;

export interface Task {
	id: string;
	pluginId: string;
	fn: string;
	args?: unknown;
}

export type EffortStatus =
	| "pending"
	| "in-progress"
	| "done" // all tasks ok — the effort OWNS and carries the result
	| "delivered" // a dispatch event was accepted by a subscriber; the effort's
	// whole job (delivery) is complete and its verb RESULT lives
	// out of band as a dispatch-result:v1 node read back by replyRef
	| "partial" // some tasks ok, some error/timeout
	| "failed" // all tasks failed, or effort failed before any task ran
	| "timed-out" // effort expired during execution
	| "cancelled";

/** Terminal states — no further transitions except via retry().
 *
 * `delivered` is terminal and honest: unlike `done` (which asserts the effort
 * carries a completed task result), a delivered dispatch effort carries only a
 * delivery receipt — the verb result is owned by an out-of-band graph node, so
 * the effort has nothing left to do and watch loops must stop on it. */
export const EFFORT_TERMINAL_STATES: ReadonlySet<EffortStatus> = new Set([
	"done",
	"delivered",
	"partial",
	"failed",
	"timed-out",
	"cancelled",
]);

export interface Effort {
	id: string;
	direction: string;
	tasks: Task[];
	source?: string;
	context?: unknown;
	submittedAt: string;
	/** Relative ordering hint. Lower number = higher priority. */
	priority?: number;
	/** Arbitrary categorisation labels. */
	tags?: string[];
}

export type TaskResultStatus =
	| "ok"
	| "error"
	| "timeout" // task individually timed out
	| "skipped" // never attempted — effort was cancelled/timed-out before this task ran
	| "cancelled"; // task was running when effort was cancelled

export interface TaskResult {
	taskId: string;
	effortId: string;
	status: TaskResultStatus;
	result?: unknown;
	error?: string;
	attempts?: number;
	startedAt?: string;
	completedAt: string;
}

export interface EffortResult {
	effortId: string;
	status: EffortStatus;
	results: TaskResult[];
	submittedAt?: string;
	startedAt?: string;
	attemptCount?: number;
	lastUpdatedAt?: string;
	completedAt?: string;
}

export interface EffortLogEntry {
	effortId: string;
	timestamp: string;
	level: "info" | "warn" | "error";
	event:
		| "submitted"
		| "processing_started"
		| "task_attempt_started"
		| "task_attempt_succeeded"
		| "task_attempt_failed"
		| "task_attempt_timed_out"
		| "task_skipped"
		| "retry_requested"
		| "cancel_requested"
		| "timed_out"
		| "processing_finished";
	message: string;
	taskId?: string;
	attempt?: number;
	meta?: Record<string, unknown>;
}

export interface EffortSummary {
	total: number;
	pending: number;
	inProgress: number;
	done: number;
	delivered: number;
	partial: number;
	failed: number;
	timedOut: number;
	cancelled: number;
}

export interface EffortSourceAdapter {
	submit(effort: Effort): Promise<string>;
}

export interface EffortTransportAdapter extends EffortSourceAdapter {
	query(effortId: string): Promise<EffortResult | null>;
	subscribe?(fn: (result: EffortResult) => void): () => void;
	list?(): Promise<EffortResult[]>;
	logs?(effortId: string): Promise<EffortLogEntry[] | null>;
	retry?(effortId: string): Promise<boolean>;
	cancel?(effortId: string): Promise<boolean>;
	summary?(): Promise<EffortSummary>;
}

export interface EffortConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

/**
 * WHICH RESOURCE A TASK SPENDS — a model call, or ordinary computation.
 *
 * This is the operator's budgeting axis, in his own words (2026-08-28): "tarefas que realmente
 * precisam de modelos para rodar ou só computação normal com recursos normais também no cálculo".
 * A surface that declares work must be able to say which half it is BEFORE it runs, because a
 * task dispatched to a model that did not need one is invisible waste, and one done by hand that
 * did need one is the operator carrying the system.
 *
 * THE RULE IS THE HOST'S, NOT A SECOND OPINION. `effort_activity_kind` in
 * `packages/tractor/src/sidecar/dispatch.rs` decides it at run time:
 *
 *     Some("respond") | None => "agent",
 *     Some(_)                => "dispatch",
 *
 * `respond` is the agent's prompt turn — the long model call. Every other verb is a direct
 * plugin dispatch. An absent `fn` defaults to `respond`, which is why `undefined` reads as
 * `agent` here too rather than as "unknown".
 *
 * The two spellings live in two languages and cannot share code, so a guard READS the Rust
 * source and asserts they still agree — the same device `PROCESS_HANDOFF_OUTPUT_CAP_BYTES`
 * uses for its host twin. A restated constant that drifts is worse than one that is derived.
 */
export type TaskWorkClass = "agent" | "dispatch";

/** The verb whose dispatch is a model turn, and the default when a task names none. */
export const AGENT_RESPOND_FN = "respond" as const;

/** PURE. Which resource this task spends. Mirrors `effort_activity_kind`. */
export function taskWorkClass(fn: string | undefined | null): TaskWorkClass {
	return fn == null || fn === AGENT_RESPOND_FN ? "agent" : "dispatch";
}
