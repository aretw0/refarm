import type http from "node:http";
import type {
	Task,
	TaskContractAdapter,
	TaskEvent,
	TaskFilter,
	TaskStatus,
} from "@refarm.dev/task-contract-v1";

const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
	"pending",
	"active",
	"blocked",
	"done",
	"failed",
	"cancelled",
	"deferred",
]);

function json(res: http.ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

function parseLimit(raw: string | null): number | null {
	if (raw === null) return null;
	const parsed = Number.parseInt(raw, 10);
	if (!/^\d+$/u.test(raw) || !Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
		return null;
	}
	return parsed;
}

function parseStatus(raw: string | null): TaskStatus | undefined | null {
	if (raw === null || raw.trim().length === 0) return undefined;
	return TASK_STATUSES.has(raw as TaskStatus) ? (raw as TaskStatus) : null;
}

function shortId(id: string): string {
	return id.split(":").at(-1) ?? id;
}

function resolveTaskPrefix(tasks: Task[], prefix: string): Task | "ambiguous" | null {
	const exact = tasks.find((task) => task["@id"] === prefix);
	if (exact) return exact;

	const matches = tasks.filter((task) => {
		const id = task["@id"];
		return id.startsWith(prefix) || shortId(id).startsWith(prefix);
	});
	if (matches.length === 0) return null;
	if (matches.length > 1) return "ambiguous";
	return matches[0]!;
}

function sortNewestFirst<T extends { created_at_ns?: number; timestamp_ns?: number }>(
	items: T[],
): T[] {
	return [...items].sort((left, right) => {
		const leftNs = left.created_at_ns ?? left.timestamp_ns ?? 0;
		const rightNs = right.created_at_ns ?? right.timestamp_ns ?? 0;
		return rightNs - leftNs;
	});
}

export function createTasksRouteHandler(adapter: TaskContractAdapter) {
	return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");

		if (requestUrl.pathname === "/tasks") {
			void (async () => {
				try {
					if (req.method !== "GET") {
						json(res, 405, { error: "method not allowed" });
						return;
					}

					const limit = parseLimit(requestUrl.searchParams.get("limit"));
					if (requestUrl.searchParams.has("limit") && limit === null) {
						json(res, 400, { error: "invalid limit" });
						return;
					}

					const status = parseStatus(requestUrl.searchParams.get("status"));
					if (status === null) {
						json(res, 400, { error: "invalid status" });
						return;
					}

					const sessionId = requestUrl.searchParams.get("session_id") ?? undefined;
					const filter: TaskFilter = {};
					if (status) filter.status = status;
					if (sessionId) filter.context_id = sessionId;

					const tasks = sortNewestFirst(await adapter.query?.(filter) ?? []);
					json(res, 200, { tasks: limit === null ? tasks : tasks.slice(0, limit) });
				} catch (error) {
					json(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		const showMatch = requestUrl.pathname.match(/^\/tasks\/([^/]+)$/u);
		if (!showMatch) return false;

		void (async () => {
			try {
				if (req.method !== "GET") {
					json(res, 405, { error: "method not allowed" });
					return;
				}

				const prefix = decodeURIComponent(showMatch[1]!);
				const tasks = await adapter.query?.({}) ?? [];
				const task = resolveTaskPrefix(tasks, prefix);
				if (task === null) {
					json(res, 404, { error: "not found" });
					return;
				}
				if (task === "ambiguous") {
					json(res, 409, {
						error: "ambiguous task prefix",
						matches: tasks
							.filter((candidate) =>
								candidate["@id"].startsWith(prefix) ||
								shortId(candidate["@id"]).startsWith(prefix),
							)
							.map((candidate) => candidate["@id"]),
					});
					return;
				}

				const events = sortNewestFirst<TaskEvent>(
					await adapter.events?.(task["@id"]) ?? [],
				);
				json(res, 200, { task, events });
			} catch (error) {
				json(res, 500, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();
		return true;
	};
}
