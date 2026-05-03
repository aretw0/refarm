import { describe, expect, it, vi } from "vitest";
import { createTaskMemoryBridge } from "./task-memory-bridge.js";

function sampleEffortTask(id = "task-1") {
	return {
		id,
		pluginId: "@refarm/pi-agent",
		fn: "respond",
		args: { prompt: "hello" },
	};
}

describe("TaskMemoryBridge", () => {
	it("creates task once and reuses mapping for same effort/task id", async () => {
		const create = vi.fn().mockResolvedValue({
			"@type": "Task",
			"@id": "urn:refarm:task:v1:abc",
			title: "@refarm/pi-agent.respond",
			status: "active",
			created_by: "urn:refarm:farmhand:test",
			assigned_to: "urn:refarm:farmhand:test",
			context_id: "urn:refarm:effort:v1:effort-1",
			parent_task_id: null,
			created_at_ns: 1,
			updated_at_ns: 1,
		});
		const appendEvent = vi.fn().mockResolvedValue({
			"@type": "TaskEvent",
			"@id": "urn:refarm:task-event:v1:1",
		});
		const update = vi.fn();

		const bridge = createTaskMemoryBridge({
			adapter: {
				create,
				get: vi.fn(),
				update,
				appendEvent,
			},
			actorUrn: "urn:refarm:farmhand:test",
		});

		const first = await bridge.ensureTask(
			sampleEffortTask("task-1"),
			"effort-1",
		);
		const second = await bridge.ensureTask(
			sampleEffortTask("task-1"),
			"effort-1",
		);

		expect(first).toBe("urn:refarm:task:v1:abc");
		expect(second).toBe(first);
		expect(create).toHaveBeenCalledTimes(1);
		expect(appendEvent).toHaveBeenCalledTimes(1);
		expect(update).not.toHaveBeenCalled();
	});

	it("records done outcome as status_changed event", async () => {
		const create = vi.fn().mockResolvedValue({
			"@type": "Task",
			"@id": "urn:refarm:task:v1:done-task",
			title: "@refarm/pi-agent.respond",
			status: "active",
			created_by: "urn:refarm:farmhand:test",
			assigned_to: "urn:refarm:farmhand:test",
			context_id: "urn:refarm:effort:v1:effort-done",
			parent_task_id: null,
			created_at_ns: 1,
			updated_at_ns: 1,
		});
		const update = vi.fn().mockResolvedValue({
			"@type": "Task",
			"@id": "urn:refarm:task:v1:done-task",
			status: "done",
		});
		const appendEvent = vi.fn().mockResolvedValue({
			"@type": "TaskEvent",
			"@id": "urn:refarm:task-event:v1:2",
		});

		const bridge = createTaskMemoryBridge({
			adapter: {
				create,
				get: vi.fn(),
				update,
				appendEvent,
			},
			actorUrn: "urn:refarm:farmhand:test",
		});

		await bridge.recordOutcome(sampleEffortTask("task-done"), "effort-done", {
			status: "ok",
		});

		expect(update).toHaveBeenCalledWith("urn:refarm:task:v1:done-task", {
			status: "done",
			assigned_to: "urn:refarm:farmhand:test",
		});
		expect(appendEvent).toHaveBeenCalledTimes(2);
		expect(appendEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				event: "status_changed",
				payload: expect.objectContaining({ status: "done", error: null }),
			}),
		);
	});

	it("records failed outcome when executor returns error", async () => {
		const create = vi.fn().mockResolvedValue({
			"@type": "Task",
			"@id": "urn:refarm:task:v1:failed-task",
			title: "@refarm/pi-agent.respond",
			status: "active",
			created_by: "urn:refarm:farmhand:test",
			assigned_to: "urn:refarm:farmhand:test",
			context_id: "urn:refarm:effort:v1:effort-failed",
			parent_task_id: null,
			created_at_ns: 1,
			updated_at_ns: 1,
		});
		const update = vi.fn().mockResolvedValue({
			"@type": "Task",
			"@id": "urn:refarm:task:v1:failed-task",
			status: "failed",
		});
		const appendEvent = vi.fn().mockResolvedValue({
			"@type": "TaskEvent",
			"@id": "urn:refarm:task-event:v1:3",
		});

		const bridge = createTaskMemoryBridge({
			adapter: {
				create,
				get: vi.fn(),
				update,
				appendEvent,
			},
			actorUrn: "urn:refarm:farmhand:test",
		});

		await bridge.recordOutcome(
			sampleEffortTask("task-failed"),
			"effort-failed",
			{
				status: "error",
				error: "timeout",
			},
		);

		expect(update).toHaveBeenCalledWith("urn:refarm:task:v1:failed-task", {
			status: "failed",
			assigned_to: "urn:refarm:farmhand:test",
		});
		expect(appendEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				event: "status_changed",
				payload: expect.objectContaining({
					status: "failed",
					error: "timeout",
				}),
			}),
		);
	});
});
