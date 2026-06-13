import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInMemoryAutomationAdapter } from "@refarm.dev/automation-contract-v1";
import type { Effort, Task } from "@refarm.dev/effort-contract-v1";
import { createInMemoryTaskAdapter } from "@refarm.dev/task-contract-v1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskMemoryBridge } from "../task-memory-bridge.js";
import { FileTransportAdapter, type TaskExecutorFn } from "./file.js";
import { HttpSidecar } from "./http.js";
import { createTasksRouteHandler } from "./tasks.js";

const TEST_BASE = path.join(os.tmpdir(), `refarm-effort-chat-${Date.now()}`);

async function request(
	port: number,
	method: string,
	pathname: string,
	body?: unknown,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const payload = body ? JSON.stringify(body) : undefined;
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				method,
				path: pathname,
				agent: false,
				headers: payload
					? {
							"content-type": "application/json",
							"content-length": Buffer.byteLength(payload),
						}
					: {},
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
		if (payload) req.write(payload);
		req.end();
	});
}

function sidecarPort(sidecar: HttpSidecar): number {
	const address = sidecar.httpServer.address();
	if (!address || typeof address === "string") {
		throw new Error("sidecar did not bind to a TCP port");
	}
	return address.port;
}

async function waitFor<T>(
	read: () => Promise<T>,
	done: (value: T) => boolean,
): Promise<T> {
	const deadline = Date.now() + 1_000;
	let last = await read();
	while (!done(last) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		last = await read();
	}
	return last;
}

describe("Effort chat integration", () => {
	afterEach(() => {
		fs.rmSync(TEST_BASE, { recursive: true, force: true });
	});

	it("turns a chat-shaped Automation trigger into a processed Effort with task memory", async () => {
		const taskAdapter = createInMemoryTaskAdapter({
			idFactory: (() => {
				let index = 0;
				const ids = ["chat-task", "created-event", "done-event"];
				return () => ids[index++] ?? `extra-${index}`;
			})(),
			nowNs: (() => {
				let ns = 1;
				return () => ns++;
			})(),
		});
		const taskMemory = createTaskMemoryBridge({
			adapter: taskAdapter,
			actorUrn: "urn:refarm:actor:v1:farmhand",
		});
		const executor = vi.fn(
			async (task: Task, effortId: string) => {
				await taskMemory.ensureTask(task, effortId);
				await taskMemory.recordOutcome(task, effortId, { status: "ok" });
				return {
					status: "ok" as const,
					result: {
						effortId,
						pluginId: task.pluginId,
						fn: task.fn,
						args: task.args,
					},
				};
			},
		);
		const effortTransport = new FileTransportAdapter(
			TEST_BASE,
			executor as TaskExecutorFn,
		);
		const sidecar = new HttpSidecar(0, effortTransport);
		sidecar.addRouteHandler(createTasksRouteHandler(taskAdapter));
		const automations = createInMemoryAutomationAdapter();

		try {
			await sidecar.start();
			const port = sidecarPort(sidecar);

			const automation = await automations.create({
				name: "Submit REPL chat effort",
				description: "Maps a REPL chat command into an executable Effort.",
				triggers: [{ type: "manual" }],
				body: {
					type: "template",
					effort: {
						direction: "{{message}}",
						source: "farmhand:repl",
						tags: ["chat", "repl"],
						context: {
							channel: "effort-chat",
							replyTo: "terminal",
						},
						tasks: [
							{
								id: "chat-turn",
								pluginId: "@refarm.dev/model-mock",
								fn: "complete",
								args: {
									message: "{{message}}",
									sessionId: "{{sessionId}}",
								},
							},
						],
					},
				},
			});

			await automations.validate(automation.id);
			await automations.activate(automation.id);

			const effort = await automations.trigger(automation.id, {
				message: "Summarize the release plan",
				sessionId: "session-123",
			});

			expect(effort).not.toBeNull();
			expect(effort?.direction).toBe("Summarize the release plan");
			expect(effort?.source).toBe("farmhand:repl");

			const submitted = await request(port, "POST", "/efforts", effort as Effort);
			expect(submitted.status).toBe(200);
			const effortId = (submitted.body as { effortId: string }).effortId;

			const result = await waitFor(
				() => effortTransport.query(effortId),
				(value) => value?.status === "done",
			);
			expect(result?.status).toBe("done");
			expect(result?.results).toHaveLength(1);
			expect(result?.results[0]?.status).toBe("ok");
			expect(executor).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "chat-turn",
					pluginId: "@refarm.dev/model-mock",
					fn: "complete",
				}),
				effortId,
				expect.objectContaining({
					direction: "Summarize the release plan",
					context: expect.objectContaining({
						channel: "effort-chat",
						replyTo: "terminal",
					}),
				}),
			);

			const taskList = await request(
				port,
				"GET",
				`/tasks?status=done&session_id=${encodeURIComponent(`urn:refarm:effort:v1:${effortId}`)}`,
			);
			expect(taskList.status).toBe(200);
			const tasks = (
				taskList.body as {
					tasks: Array<{ "@id": string; title: string; status: string }>;
				}
			).tasks;
			expect(tasks).toEqual([
				expect.objectContaining({
					title: "@refarm.dev/model-mock.complete",
					status: "done",
				}),
			]);

			const taskIdPrefix = tasks[0]!["@id"].split(":").at(-1)!;
			const taskDetails = await request(port, "GET", `/tasks/${taskIdPrefix}`);
			expect(taskDetails.status).toBe(200);
			expect(
				(
					taskDetails.body as { events: Array<{ event: string }> }
				).events.map((event) => event.event),
			).toEqual(["status_changed", "created"]);

			const logs = await effortTransport.logs(effortId);
			expect(logs?.map((entry) => entry.event)).toContain("processing_finished");
		} finally {
			await sidecar.stop();
		}
	});
});
