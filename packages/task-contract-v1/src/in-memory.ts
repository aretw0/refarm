import type {
	Task,
	TaskContractAdapter,
	TaskEvent,
	TaskStatus,
	TaskSummary,
} from "./types.js";

const TASK_STATUSES: TaskStatus[] = [
	"pending",
	"active",
	"blocked",
	"done",
	"failed",
	"cancelled",
	"deferred",
];

export interface InMemoryTaskAdapterOptions {
	idFactory?: () => string;
	nowNs?: () => number;
}

function defaultIdFactory(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultNowNs(): number {
	// Keep timestamp arithmetic within Number.MAX_SAFE_INTEGER precision.
	return Date.now() * 1_000;
}

function nextNs(nowNs: () => number, previous?: number): number {
	const current = nowNs();
	if (previous === undefined) {
		return current;
	}
	return current > previous ? current : previous + 1;
}

export function createInMemoryTaskAdapter(
	options: InMemoryTaskAdapterOptions = {},
): TaskContractAdapter {
	const idFactory = options.idFactory ?? defaultIdFactory;
	const nowNs = options.nowNs ?? defaultNowNs;
	const tasks = new Map<string, Task>();
	const eventsByTask = new Map<string, TaskEvent[]>();
	let lastNs = 0;

	function issueNs(): number {
		lastNs = nextNs(nowNs, lastNs);
		return lastNs;
	}

	return {
		async create(taskInput) {
			const id = `urn:refarm:task:v1:${idFactory()}`;
			const timestamp = issueNs();
			const task: Task = {
				...taskInput,
				"@type": "Task",
				"@id": id,
				created_at_ns: timestamp,
				updated_at_ns: timestamp,
			};
			tasks.set(id, task);
			return task;
		},

		async get(id) {
			return tasks.get(id) ?? null;
		},

		async update(id, patch) {
			const current = tasks.get(id);
			if (!current) {
				throw new Error(`Task not found: ${id}`);
			}

			const updated: Task = {
				...current,
				...patch,
				"@id": current["@id"],
				"@type": "Task",
				created_at_ns: current.created_at_ns,
				updated_at_ns: issueNs(),
			};
			tasks.set(id, updated);
			return updated;
		},

		async appendEvent(eventInput) {
			if (!tasks.has(eventInput.task_id)) {
				throw new Error(
					`Task not found for event append: ${eventInput.task_id}`,
				);
			}

			const event: TaskEvent = {
				...eventInput,
				"@type": "TaskEvent",
				"@id": `urn:refarm:task-event:v1:${idFactory()}`,
				timestamp_ns: issueNs(),
			};

			const events = eventsByTask.get(event.task_id) ?? [];
			events.push(event);
			eventsByTask.set(event.task_id, events);
			return event;
		},

		async query(filter) {
			let items = Array.from(tasks.values());

			if (filter.status !== undefined) {
				const allowed = Array.isArray(filter.status)
					? filter.status
					: [filter.status];
				items = items.filter((task) => allowed.includes(task.status));
			}

			if (filter.assigned_to !== undefined) {
				items = items.filter((task) => task.assigned_to === filter.assigned_to);
			}

			if (filter.context_id !== undefined) {
				items = items.filter((task) => task.context_id === filter.context_id);
			}

			if (filter.parent_task_id !== undefined) {
				items = items.filter(
					(task) => task.parent_task_id === filter.parent_task_id,
				);
			}

			return items.sort((a, b) => a.created_at_ns - b.created_at_ns);
		},

		async events(taskId) {
			const events = eventsByTask.get(taskId) ?? [];
			return [...events].sort((a, b) => a.timestamp_ns - b.timestamp_ns);
		},

		async summary() {
			const by_status: TaskSummary["by_status"] = {
				pending: 0,
				active: 0,
				blocked: 0,
				done: 0,
				failed: 0,
				cancelled: 0,
				deferred: 0,
			};

			for (const task of tasks.values()) {
				if (TASK_STATUSES.includes(task.status)) {
					by_status[task.status] += 1;
				}
			}

			return {
				total: tasks.size,
				by_status,
			};
		},
	};
}
