import { describe, expect, it } from "vitest";
import { createInMemoryTaskAdapter } from "./in-memory.js";

describe("createInMemoryTaskAdapter", () => {
	it("supports root/subtask filtering and chronological events", async () => {
		const adapter = createInMemoryTaskAdapter();
		const root = await adapter.create({
			"@type": "Task",
			title: "root",
			status: "pending",
			created_by: "urn:test:agent",
			assigned_to: "urn:test:agent",
			context_id: "urn:test:session:1",
			parent_task_id: null,
		});
		await adapter.create({
			"@type": "Task",
			title: "sub",
			status: "pending",
			created_by: "urn:test:agent",
			assigned_to: "urn:test:agent",
			context_id: "urn:test:session:1",
			parent_task_id: root["@id"],
		});

		await adapter.appendEvent({
			"@type": "TaskEvent",
			task_id: root["@id"],
			event: "created",
			actor: "urn:test:agent",
			payload: {},
		});
		await adapter.appendEvent({
			"@type": "TaskEvent",
			task_id: root["@id"],
			event: "status_changed",
			actor: "urn:test:agent",
			payload: { to: "active" },
		});

		const rootOnly = await adapter.query?.({ parent_task_id: null });
		expect(rootOnly).toHaveLength(1);
		expect(rootOnly?.[0]["@id"]).toBe(root["@id"]);

		const events = await adapter.events?.(root["@id"]);
		expect(events?.length).toBe(2);
		expect(events?.[0].timestamp_ns).toBeLessThan(
			events?.[1].timestamp_ns ?? 0,
		);
	});
});
