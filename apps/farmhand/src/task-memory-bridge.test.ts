import { describe, expect, it, vi } from "vitest";
import { createTaskMemoryBridge } from "./task-memory-bridge.js";

const ACTOR_URN = "urn:refarm:farmhand:test";

function sampleEffortTask(id = "task-1") {
	return {
		id,
		pluginId: "@refarm/pi-agent",
		fn: "respond",
		args: { prompt: "hello" },
	};
}

function aliasEffortTask(id = "task-alias") {
	return {
		...sampleEffortTask(id),
		pluginId: "@refarm.dev/pi-agent",
	};
}

function makeTask(id: string, contextId: string) {
	return {
		"@type": "Task",
		"@id": `urn:refarm:task:v1:${id}`,
		title: "@refarm/pi-agent.respond",
		status: "active",
		created_by: ACTOR_URN,
		assigned_to: ACTOR_URN,
		context_id: `urn:refarm:effort:v1:${contextId}`,
		parent_task_id: null,
		created_at_ns: 1,
		updated_at_ns: 1,
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeAdapter(overrides: Record<string, any> = {}) {
	return {
		create: vi.fn(),
		get: vi.fn(),
		update: vi.fn(),
		appendEvent: vi.fn(),
		delete: vi.fn(),
		...overrides,
	};
}

function makeBridge(adapter: ReturnType<typeof makeAdapter>) {
	return createTaskMemoryBridge({ adapter, actorUrn: ACTOR_URN });
}

describe("TaskMemoryBridge", () => {
	it("creates task once and reuses mapping for same effort/task id", async () => {
		const create = vi.fn().mockResolvedValue(makeTask("abc", "effort-1"));
		const appendEvent = vi.fn().mockResolvedValue({ "@type": "TaskEvent", "@id": "urn:refarm:task-event:v1:1" });
		const adapter = makeAdapter({ create, appendEvent });
		const bridge = makeBridge(adapter);

		const first = await bridge.ensureTask(sampleEffortTask("task-1"), "effort-1");
		const second = await bridge.ensureTask(sampleEffortTask("task-1"), "effort-1");

		expect(first).toBe("urn:refarm:task:v1:abc");
		expect(second).toBe(first);
		expect(create).toHaveBeenCalledTimes(1);
		expect(appendEvent).toHaveBeenCalledTimes(1);
		expect(adapter.update).not.toHaveBeenCalled();
	});

	it("normalizes plugin aliases in task title and created event payload", async () => {
		const create = vi.fn().mockResolvedValue(makeTask("alias", "effort-alias"));
		const appendEvent = vi.fn().mockResolvedValue({ "@type": "TaskEvent", "@id": "urn:refarm:task-event:v1:alias" });
		const adapter = makeAdapter({ create, appendEvent });
		const bridge = makeBridge(adapter);

		await bridge.ensureTask(aliasEffortTask(), "effort-alias");

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "@refarm/pi-agent.respond",
			}),
		);
		expect(appendEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					pluginId: "@refarm/pi-agent",
				}),
			}),
		);
	});

	it("records done outcome as status_changed event", async () => {
		const create = vi.fn().mockResolvedValue(makeTask("done-task", "effort-done"));
		const update = vi.fn().mockResolvedValue({ "@type": "Task", "@id": "urn:refarm:task:v1:done-task", status: "done" });
		const appendEvent = vi.fn().mockResolvedValue({ "@type": "TaskEvent", "@id": "urn:refarm:task-event:v1:2" });
		const bridge = makeBridge(makeAdapter({ create, update, appendEvent }));

		await bridge.recordOutcome(sampleEffortTask("task-done"), "effort-done", { status: "ok" });

		expect(update).toHaveBeenCalledWith("urn:refarm:task:v1:done-task", {
			status: "done",
			assigned_to: ACTOR_URN,
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
		const create = vi.fn().mockResolvedValue(makeTask("failed-task", "effort-failed"));
		const update = vi.fn().mockResolvedValue({ "@type": "Task", "@id": "urn:refarm:task:v1:failed-task", status: "failed" });
		const appendEvent = vi.fn().mockResolvedValue({ "@type": "TaskEvent", "@id": "urn:refarm:task-event:v1:3" });
		const bridge = makeBridge(makeAdapter({ create, update, appendEvent }));

		await bridge.recordOutcome(sampleEffortTask("task-failed"), "effort-failed", {
			status: "error",
			error: "timeout",
		});

		expect(update).toHaveBeenCalledWith("urn:refarm:task:v1:failed-task", {
			status: "failed",
			assigned_to: ACTOR_URN,
		});
		expect(appendEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				event: "status_changed",
				payload: expect.objectContaining({ status: "failed", error: "timeout" }),
			}),
		);
	});
});
