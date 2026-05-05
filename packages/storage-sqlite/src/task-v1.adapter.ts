import type {
	StorageProvider,
	StorageRecord,
} from "@refarm.dev/storage-contract-v1";
import type {
	Task,
	TaskContractAdapter,
	TaskEvent,
	TaskFilter,
	TaskStatus,
	TaskSummary,
} from "@refarm.dev/task-contract-v1";


const TASK_RECORD_TYPE = "Task";
const TASK_EVENT_RECORD_TYPE = "TaskEvent";

const TASK_STATUS_VALUES: TaskStatus[] = [
	"pending",
	"active",
	"blocked",
	"done",
	"failed",
	"cancelled",
	"deferred",
];

export interface StorageTaskV1AdapterOptions {
	provider?: StorageProvider;
	idFactory?: () => string;
	nowNs?: () => number;
}

function defaultIdFactory(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultNowNs(): number {
	// Keep monotonic arithmetic under Number.MAX_SAFE_INTEGER.
	return Date.now() * 1_000;
}

function nextNs(nowNs: () => number, previous?: number): number {
	const current = nowNs();
	if (previous === undefined) return current;
	return current > previous ? current : previous + 1;
}

function parsePayload<T>(record: StorageRecord | null): T | null {
	if (!record) return null;
	try {
		return JSON.parse(record.payload) as T;
	} catch {
		return null;
	}
}

function asTask(value: unknown): Task | null {
	if (!value || typeof value !== "object") return null;
	const task = value as Task;
	if (task["@type"] !== "Task" || typeof task["@id"] !== "string") return null;
	return task;
}

function asTaskEvent(value: unknown): TaskEvent | null {
	if (!value || typeof value !== "object") return null;
	const event = value as TaskEvent;
	if (
		event["@type"] !== "TaskEvent" ||
		typeof event["@id"] !== "string" ||
		typeof event.task_id !== "string"
	) {
		return null;
	}
	return event;
}

function applyTaskFilter(tasks: Task[], filter: TaskFilter): Task[] {
	let filtered = tasks;

	if (filter.status) {
		const statuses = Array.isArray(filter.status)
			? new Set(filter.status)
			: new Set([filter.status]);
		filtered = filtered.filter((task) => statuses.has(task.status));
	}

	if (filter.assigned_to !== undefined) {
		filtered = filtered.filter(
			(task) => task.assigned_to === filter.assigned_to,
		);
	}

	if (filter.context_id !== undefined) {
		filtered = filtered.filter((task) => task.context_id === filter.context_id);
	}

	if ("parent_task_id" in filter) {
		filtered = filtered.filter(
			(task) => task.parent_task_id === filter.parent_task_id,
		);
	}

	return filtered;
}

function emptyTaskSummary(): TaskSummary {
	return {
		total: 0,
		by_status: {
			pending: 0,
			active: 0,
			blocked: 0,
			done: 0,
			failed: 0,
			cancelled: 0,
			deferred: 0,
		},
	};
}

function createFallbackStorageProvider(): StorageProvider {
	const rows = new Map<string, StorageRecord>();
	return {
		pluginId: "@refarm.dev/storage-sqlite/task-v1-fallback",
		capability: "storage:v1",
		async get(id) {
			return rows.get(id) ?? null;
		},
		async put(record) {
			rows.set(record.id, record);
		},
		async delete(id) {
			rows.delete(id);
		},
		async query(query) {
			let values = [...rows.values()];
			if (query.type) values = values.filter((row) => row.type === query.type);
			const offset = query.offset ?? 0;
			const limit = query.limit ?? values.length;
			return values.slice(offset, offset + limit);
		},
	};
}

export function createTaskV1StorageAdapter(
	options: StorageTaskV1AdapterOptions = {},
): TaskContractAdapter {
	const provider = options.provider ?? createFallbackStorageProvider();
	const idFactory = options.idFactory ?? defaultIdFactory;
	const nowNs = options.nowNs ?? defaultNowNs;
	let lastNs = 0;

	function issueNs(): number {
		lastNs = nextNs(nowNs, lastNs);
		return lastNs;
	}

	async function readTask(
		id: string,
	): Promise<{ record: StorageRecord; task: Task } | null> {
		const record = await provider.get(id);
		if (!record || record.type !== TASK_RECORD_TYPE) return null;
		const task = asTask(parsePayload<Task>(record));
		if (!task) return null;
		return { record, task };
	}

	return {
		async create(taskInput) {
			const timestamp = issueNs();
			const task: Task = {
				...taskInput,
				"@type": "Task",
				"@id": `urn:refarm:task:v1:${idFactory()}`,
				created_at_ns: timestamp,
				updated_at_ns: timestamp,
			};
			const nowIso = new Date().toISOString();
			await provider.put({
				id: task["@id"],
				type: TASK_RECORD_TYPE,
				payload: JSON.stringify(task),
				createdAt: nowIso,
				updatedAt: nowIso,
			});
			return task;
		},

		async get(id) {
			return (await readTask(id))?.task ?? null;
		},

		async update(id, patch) {
			const current = await readTask(id);
			if (!current) throw new Error(`Task not found: ${id}`);
			const updated: Task = {
				...current.task,
				...patch,
				"@type": "Task",
				"@id": current.task["@id"],
				created_at_ns: current.task.created_at_ns,
				updated_at_ns: issueNs(),
			};
			await provider.put({
				...current.record,
				payload: JSON.stringify(updated),
				updatedAt: new Date().toISOString(),
			});
			return updated;
		},

		async appendEvent(eventInput) {
			const task = await readTask(eventInput.task_id);
			if (!task) {
				throw new Error(
					`Task not found for appendEvent: ${eventInput.task_id}`,
				);
			}
			const event: TaskEvent = {
				...eventInput,
				"@type": "TaskEvent",
				"@id": `urn:refarm:task-event:v1:${idFactory()}`,
				timestamp_ns: issueNs(),
			};
			const nowIso = new Date().toISOString();
			await provider.put({
				id: event["@id"],
				type: TASK_EVENT_RECORD_TYPE,
				payload: JSON.stringify(event),
				createdAt: nowIso,
				updatedAt: nowIso,
			});
			return event;
		},

		async query(filter) {
			const records = await provider.query({ type: TASK_RECORD_TYPE });
			const tasks = records
				.map((record) => asTask(parsePayload<Task>(record)))
				.filter((task): task is Task => Boolean(task))
				.sort((a, b) => a.created_at_ns - b.created_at_ns);
			return applyTaskFilter(tasks, filter);
		},

		async events(taskId) {
			const records = await provider.query({ type: TASK_EVENT_RECORD_TYPE });
			return records
				.map((record) => asTaskEvent(parsePayload<TaskEvent>(record)))
				.filter((event): event is TaskEvent => Boolean(event))
				.filter((event) => event.task_id === taskId)
				.sort((a, b) => a.timestamp_ns - b.timestamp_ns);
		},

		async summary() {
			const records = await provider.query({ type: TASK_RECORD_TYPE });
			const summary = emptyTaskSummary();
			for (const record of records) {
				const task = asTask(parsePayload<Task>(record));
				if (!task) continue;
				summary.total += 1;
				if (TASK_STATUS_VALUES.includes(task.status)) {
					summary.by_status[task.status] += 1;
				}
			}
			return summary;
		},
	};
}
