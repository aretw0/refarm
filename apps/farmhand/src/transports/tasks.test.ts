import http from "node:http";
import { createInMemoryTaskAdapter } from "@refarm.dev/task-contract-v1";
import type { TaskContractAdapter } from "@refarm.dev/task-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSidecar } from "./http.js";
import { createTasksRouteHandler } from "./tasks.js";

function makeAdapter() {
	return {
		submit: vi.fn().mockResolvedValue("e1"),
		query: vi.fn().mockResolvedValue(null),
		list: vi.fn().mockResolvedValue([]),
		logs: vi.fn().mockResolvedValue([]),
		retry: vi.fn().mockResolvedValue(true),
		cancel: vi.fn().mockResolvedValue(true),
		summary: vi.fn().mockResolvedValue({
			total: 0,
			pending: 0,
			inProgress: 0,
			done: 0,
			failed: 0,
			cancelled: 0,
		}),
		process: vi.fn().mockResolvedValue(undefined),
	};
}

async function request(
	port: number,
	method: string,
	path: string,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				method,
				path,
				agent: false,
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					resolve({
						status: res.statusCode ?? 0,
						body: JSON.parse(data || "null"),
					});
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}

async function seedTask(
	adapter: TaskContractAdapter,
	options: {
		title: string;
		status?: "active" | "done" | "failed";
		contextId?: string;
	},
) {
	const task = await adapter.create({
		"@type": "Task",
		title: options.title,
		status: options.status ?? "active",
		created_by: "tester",
		assigned_to: "tester",
		context_id: options.contextId ?? null,
		parent_task_id: null,
	});
	await adapter.appendEvent({
		"@type": "TaskEvent",
		task_id: task["@id"],
		event: "created",
		actor: "tester",
		payload: { title: options.title },
	});
	return task;
}

describe("tasks route handler", () => {
	let sidecar: HttpSidecar;
	let taskAdapter: TaskContractAdapter;
	const PORT = 42115;

	beforeEach(async () => {
		taskAdapter = createInMemoryTaskAdapter({
			idFactory: (() => {
				let index = 0;
				const ids = ["aaa111", "event1", "aaa222", "event2", "bbb333", "event3"];
				return () => ids[index++] ?? `extra${index}`;
			})(),
			nowNs: (() => {
				let ns = 1;
				return () => ns++;
			})(),
		});
		sidecar = new HttpSidecar(PORT, makeAdapter());
		sidecar.addRouteHandler(createTasksRouteHandler(taskAdapter));
		await sidecar.start();
	});

	afterEach(async () => {
		await sidecar.stop();
	});

	it("GET /tasks lists tasks newest first with a limit", async () => {
		await seedTask(taskAdapter, { title: "older" });
		await seedTask(taskAdapter, { title: "newer", status: "done" });

		const { status, body } = await request(PORT, "GET", "/tasks?limit=1");
		expect(status).toBe(200);
		expect((body as { tasks: Array<{ title: string }> }).tasks).toEqual([
			expect.objectContaining({ title: "newer" }),
		]);
	});

	it("GET /tasks filters by status and session", async () => {
		await seedTask(taskAdapter, {
			title: "matching",
			status: "done",
			contextId: "urn:refarm:session:v1:abc",
		});
		await seedTask(taskAdapter, {
			title: "other-session",
			status: "done",
			contextId: "urn:refarm:session:v1:def",
		});
		await seedTask(taskAdapter, {
			title: "other-status",
			status: "failed",
			contextId: "urn:refarm:session:v1:abc",
		});

		const { status, body } = await request(
			PORT,
			"GET",
			"/tasks?status=done&session_id=urn%3Arefarm%3Asession%3Av1%3Aabc",
		);
		expect(status).toBe(200);
		expect((body as { tasks: Array<{ title: string }> }).tasks).toEqual([
			expect.objectContaining({ title: "matching" }),
		]);
	});

	it("GET /tasks rejects invalid filters", async () => {
		expect((await request(PORT, "GET", "/tasks?limit=0")).status).toBe(400);
		expect((await request(PORT, "GET", "/tasks?status=nope")).status).toBe(400);
	});

	it("GET /tasks/:prefix returns a task and its events", async () => {
		const task = await seedTask(taskAdapter, { title: "inspect me" });
		const prefix = task["@id"].split(":").at(-1)!.slice(0, 6);

		const { status, body } = await request(PORT, "GET", `/tasks/${prefix}`);
		expect(status).toBe(200);
		expect((body as { task: { title: string } }).task.title).toBe("inspect me");
		expect((body as { events: unknown[] }).events).toHaveLength(1);
	});

	it("GET /tasks/:prefix handles missing and ambiguous prefixes", async () => {
		await seedTask(taskAdapter, { title: "first" });
		await seedTask(taskAdapter, { title: "second" });

		const missing = await request(PORT, "GET", "/tasks/zzz");
		expect(missing.status).toBe(404);

		const ambiguous = await request(PORT, "GET", "/tasks/aaa");
		expect(ambiguous.status).toBe(409);
		expect((ambiguous.body as { matches: string[] }).matches).toHaveLength(2);
	});
});
