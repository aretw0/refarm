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
	| "done"
	| "failed"
	| "cancelled";

export interface Effort {
	id: string;
	direction: string;
	tasks: Task[];
	source?: string;
	context?: unknown;
	submittedAt: string;
}

export interface TaskResult {
	taskId: string;
	effortId: string;
	status: "ok" | "error" | "cancelled";
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
		| "retry_requested"
		| "cancel_requested"
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
	failed: number;
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
