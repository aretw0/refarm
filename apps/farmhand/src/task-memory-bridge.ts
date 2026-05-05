import type { Task as EffortTask } from "@refarm.dev/effort-contract-v1";
import type {
	Task,
	TaskContractAdapter,
	TaskStatus,
} from "@refarm.dev/task-contract-v1";

export interface TaskMemoryOutcome {
	status: "ok" | "error";
	error?: string;
}

export interface TaskMemoryBridgeOptions {
	adapter: TaskContractAdapter;
	actorUrn: string;
	contextPrefix?: string;
}

function taskKey(effortId: string, taskId: string): string {
	return `${effortId}::${taskId}`;
}

function taskStatusFromOutcome(outcome: TaskMemoryOutcome): TaskStatus {
	if (outcome.status === "ok") return "done";
	return "failed";
}

function taskTitle(task: EffortTask): string {
	return `${task.pluginId}.${task.fn}`;
}

export class TaskMemoryBridge {
	private readonly mapping = new Map<string, string>();
	private readonly contextPrefix: string;

	constructor(private readonly options: TaskMemoryBridgeOptions) {
		this.contextPrefix =
			options.contextPrefix?.trim() || "urn:refarm:effort:v1:";
	}

	async ensureTask(task: EffortTask, effortId: string): Promise<string> {
		const key = taskKey(effortId, task.id);
		const existing = this.mapping.get(key);
		if (existing) return existing;

		const created = await this.options.adapter.create({
			"@type": "Task",
			title: taskTitle(task),
			status: "active",
			created_by: this.options.actorUrn,
			assigned_to: this.options.actorUrn,
			context_id: `${this.contextPrefix}${effortId}`,
			parent_task_id: null,
		});
		this.mapping.set(key, created["@id"]);

		await this.options.adapter.appendEvent({
			"@type": "TaskEvent",
			task_id: created["@id"],
			event: "created",
			actor: this.options.actorUrn,
			payload: {
				effortId,
				taskId: task.id,
				pluginId: task.pluginId,
				fn: task.fn,
			},
		});

		return created["@id"];
	}

	async recordOutcome(
		task: EffortTask,
		effortId: string,
		outcome: TaskMemoryOutcome,
	): Promise<Task> {
		const storedTaskId = await this.ensureTask(task, effortId);
		const status = taskStatusFromOutcome(outcome);
		const updated = await this.options.adapter.update(storedTaskId, {
			status,
			assigned_to: this.options.actorUrn,
		});

		await this.options.adapter.appendEvent({
			"@type": "TaskEvent",
			task_id: storedTaskId,
			event: "status_changed",
			actor: this.options.actorUrn,
			payload: {
				effortId,
				taskId: task.id,
				status,
				error: outcome.error ?? null,
			},
		});

		return updated;
	}
}

export function createTaskMemoryBridge(
	options: TaskMemoryBridgeOptions,
): TaskMemoryBridge {
	return new TaskMemoryBridge(options);
}
