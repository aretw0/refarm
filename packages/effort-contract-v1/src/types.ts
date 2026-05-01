export const EFFORT_CAPABILITY = "effort:v1" as const;

export interface Task {
	id: string;
	pluginId: string;
	fn: string;
	args?: unknown;
}

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
	status: "ok" | "error";
	result?: unknown;
	error?: string;
	completedAt: string;
}

export interface EffortResult {
	effortId: string;
	status: "pending" | "in-progress" | "done" | "failed";
	results: TaskResult[];
	completedAt?: string;
}

export interface EffortSourceAdapter {
	submit(effort: Effort): Promise<string>;
}

export interface EffortTransportAdapter extends EffortSourceAdapter {
	query(effortId: string): Promise<EffortResult | null>;
	subscribe?(fn: (result: EffortResult) => void): () => void;
}

export interface EffortConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
