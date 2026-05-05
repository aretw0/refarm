import type {
	Task,
	TaskConformanceResult,
	TaskContractAdapter,
} from "./types.js";

export async function runTaskV1Conformance(
  adapter: TaskContractAdapter,
): Promise<TaskConformanceResult> {
  const failures: string[] = [];
  let total = 4;

  const taskInput: Omit<Task, "@id" | "created_at_ns" | "updated_at_ns"> = {
    "@type": "Task",
    title: "Conformance test task",
    status: "pending",
    created_by: "urn:refarm:conformance",
    assigned_to: null,
    context_id: null,
    parent_task_id: null,
  };

  // 1 — create
  let created: Task | undefined;
  try {
    created = await adapter.create(taskInput);
    if (!created["@id"]) failures.push("create() returned Task without @id");
    if (created["@type"] !== "Task")
      failures.push("create() returned wrong @type");
    if (!created.created_at_ns)
      failures.push("create() did not set created_at_ns");
    if (!created.updated_at_ns)
      failures.push("create() did not set updated_at_ns");
  } catch (e) {
    failures.push(`create() threw: ${String(e)}`);
  }

  // 2 — get
  if (created) {
    try {
      const fetched = await adapter.get(created["@id"]);
      if (!fetched)
        failures.push(`get() returned null for id ${created["@id"]}`);
      else if (fetched["@id"] !== created["@id"])
        failures.push("get() returned wrong @id");
    } catch (e) {
      failures.push(`get() threw: ${String(e)}`);
    }
  }

  // 3 — update
  if (created) {
    try {
      const prevUpdated = created.updated_at_ns;
      await new Promise((r) => setTimeout(r, 1));
      const updated = await adapter.update(created["@id"], {
        status: "active",
      });
      if (updated.status !== "active")
        failures.push("update() did not change status");
      if (updated.title !== created.title)
        failures.push("update() mutated unpatched field (title)");
      if (updated.updated_at_ns <= prevUpdated)
        failures.push("update() did not advance updated_at_ns");
    } catch (e) {
      failures.push(`update() threw: ${String(e)}`);
    }
  }

  // 4 — appendEvent
  if (created) {
    try {
      const ev = await adapter.appendEvent({
        "@type": "TaskEvent",
        task_id: created["@id"],
        event: "status_changed",
        actor: "urn:refarm:conformance",
        payload: { from: "pending", to: "active" },
      });
      if (!ev["@id"])
        failures.push("appendEvent() returned TaskEvent without @id");
      if (ev.task_id !== created["@id"])
        failures.push("appendEvent() returned wrong task_id");
      if (!ev.timestamp_ns)
        failures.push("appendEvent() did not set timestamp_ns");
    } catch (e) {
      failures.push(`appendEvent() threw: ${String(e)}`);
    }
  }

  // 5* — query (optional)
  if (created && adapter.query) {
    total++;
    try {
      const results = await adapter.query({ status: "active" });
      const found = results.some((t) => t["@id"] === created!["@id"]);
      if (!found)
        failures.push(
          "query({ status: 'active' }) did not return updated task",
        );

      const rootResults = await adapter.query({ parent_task_id: null });
      const rootFound = rootResults.some((t) => t["@id"] === created!["@id"]);
      if (!rootFound)
        failures.push(
          "query({ parent_task_id: null }) did not return root task",
        );
    } catch (e) {
      failures.push(`query() threw: ${String(e)}`);
    }
  }

  // 6* — events (optional)
  if (created && adapter.events) {
    total++;
    try {
      const evs = await adapter.events(created["@id"]);
      if (evs.length === 0)
        failures.push("events() returned empty list after appendEvent()");
      for (let i = 1; i < evs.length; i++) {
        if (evs[i].timestamp_ns < evs[i - 1].timestamp_ns)
          failures.push("events() not in chronological order");
      }
    } catch (e) {
      failures.push(`events() threw: ${String(e)}`);
    }
  }

  // 7* — summary (optional)
  if (adapter.summary) {
    total++;
    try {
      const s = await adapter.summary();
      if (typeof s.total !== "number")
        failures.push("summary() returned non-numeric total");
      if (!s.by_status) failures.push("summary() missing by_status");
    } catch (e) {
      failures.push(`summary() threw: ${String(e)}`);
    }
  }

	const failed = failures.length;
	return { pass: failed === 0, total, failed, failures };
}
