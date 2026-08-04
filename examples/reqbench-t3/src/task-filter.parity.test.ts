import { createInMemoryTaskAdapter, type Task, type TaskContractAdapter, type TaskFilter } from "@refarm.dev/task-contract-v1";
import { createTaskV1StorageAdapter } from "@refarm.dev/storage-sqlite";
import { describe, expect, it } from "vitest";

/**
 * PARITY GATE — task-contract-v1 lane entry 5: `TaskFilter.created_after_ns` / `.created_before_ns`
 * / `.due_before_ns` must return IDENTICAL results whether the query is answered by the in-memory
 * adapter (`@refarm.dev/task-contract-v1`'s `createInMemoryTaskAdapter`) or the SQLite-backed one
 * (`@refarm.dev/storage-sqlite`'s `createTaskV1StorageAdapter`). Before the companion fix to
 * `applyTaskFilter` (packages/storage-sqlite/src/task-v1.adapter.ts), the in-memory adapter filtered
 * on all three fields and the SQLite adapter silently ignored them — the SAME `TaskFilter` object
 * returned different result sets depending on which adapter happened to be configured, with no error
 * from either side. This test builds one fixture of tasks with staggered `created_at_ns`/`due_at_ns`,
 * runs the identical filter through both adapters, and asserts the result sets match — the same
 * cross-adapter parity shape `rcdc5-enrichment.parity.test.ts` already proves in this package,
 * applied here to the SILENTLY-DIVERGING-ADAPTERS defect instead of an external-oracle divergence.
 */

// TaskContractAdapter.query is optional on the interface (some adapters may not support it), but
// BOTH concrete factories used here implement it — narrow the type once so the rest of this file
// reads naturally instead of guarding every call site.
type QueryableTaskAdapter = TaskContractAdapter & { query: NonNullable<TaskContractAdapter["query"]> };

// An arbitrary nanosecond origin — real values, not epoch-adjacent, so a filter boundary of "0" or
// "undefined" could never accidentally match everything.
const BASE_NS = 1_780_000_000_000_000_000;

interface TaskFixture {
	title: string;
	createdAtNs: number;
	dueAtNs?: number;
}

// Staggered creation times AND staggered (partially absent) due dates, so created_after_ns,
// created_before_ns, and due_before_ns each carve out a DIFFERENT subset — a filter that silently
// no-ops would pass a same-set-as-unfiltered check but fail these narrower ones.
const FIXTURES: TaskFixture[] = [
	{ title: "task-A-earliest-due-soonest", createdAtNs: BASE_NS, dueAtNs: BASE_NS + 500 },
	{ title: "task-B-second-due-latest", createdAtNs: BASE_NS + 1_000, dueAtNs: BASE_NS + 9_000 },
	{ title: "task-C-third-no-due", createdAtNs: BASE_NS + 5_000 },
	{ title: "task-D-latest-due-early", createdAtNs: BASE_NS + 6_000, dueAtNs: BASE_NS + 100 },
];

/** A clock that replays a fixed queue of timestamps, one per `issueNs()` call — deterministic and
 * IDENTICAL across both adapters when each gets its own instance built from the same source array. */
function makeQueueClock(timestamps: number[]): () => number {
	let index = 0;
	return () => {
		const value = timestamps[Math.min(index, timestamps.length - 1)]!;
		index += 1;
		return value;
	};
}

async function seedTasks(adapter: TaskContractAdapter): Promise<Task[]> {
	const created: Task[] = [];
	for (const fixture of FIXTURES) {
		const task = await adapter.create({
			"@type": "Task",
			title: fixture.title,
			status: "pending",
			created_by: null,
			assigned_to: null,
			context_id: null,
			parent_task_id: null,
			...(fixture.dueAtNs !== undefined ? { due_at_ns: fixture.dueAtNs } : {}),
		});
		created.push(task);
	}
	return created;
}

function titlesOf(tasks: Task[]): string[] {
	return tasks.map((t) => t.title).sort();
}

describe("TaskFilter time-window fields: in-memory vs storage-sqlite parity", () => {
	async function buildAdapters(): Promise<{ inMemory: QueryableTaskAdapter; sqlite: QueryableTaskAdapter }> {
		const createdAtNs = FIXTURES.map((f) => f.createdAtNs);
		// Each adapter gets its OWN clock instance (same source sequence) so create() call #N sees
		// the same created_at_ns on both sides, without the two adapters sharing mutable state.
		const inMemory = createInMemoryTaskAdapter({ nowNs: makeQueueClock(createdAtNs) }) as QueryableTaskAdapter;
		const sqlite = createTaskV1StorageAdapter({ nowNs: makeQueueClock(createdAtNs) }) as QueryableTaskAdapter;
		await seedTasks(inMemory);
		await seedTasks(sqlite);
		return { inMemory, sqlite };
	}

	it("created_after_ns: both adapters agree, and agree with the expected subset", async () => {
		const { inMemory, sqlite } = await buildAdapters();
		const filter: TaskFilter = { created_after_ns: BASE_NS };

		const fromMemory = await inMemory.query(filter);
		const fromSqlite = await sqlite.query(filter);

		expect(titlesOf(fromSqlite)).toEqual(titlesOf(fromMemory));
		// A (created_at_ns === BASE_NS) is excluded — the filter is strictly-after.
		expect(titlesOf(fromMemory)).toEqual([
			"task-B-second-due-latest",
			"task-C-third-no-due",
			"task-D-latest-due-early",
		]);
	});

	it("created_before_ns: both adapters agree, and agree with the expected subset", async () => {
		const { inMemory, sqlite } = await buildAdapters();
		const filter: TaskFilter = { created_before_ns: BASE_NS + 5_000 };

		const fromMemory = await inMemory.query(filter);
		const fromSqlite = await sqlite.query(filter);

		expect(titlesOf(fromSqlite)).toEqual(titlesOf(fromMemory));
		// C (created_at_ns === BASE_NS + 5_000) is excluded — the filter is strictly-before.
		expect(titlesOf(fromMemory)).toEqual(["task-A-earliest-due-soonest", "task-B-second-due-latest"]);
	});

	it("due_before_ns: both adapters agree, and agree with the expected subset (undefined due_at_ns excluded)", async () => {
		const { inMemory, sqlite } = await buildAdapters();
		const filter: TaskFilter = { due_before_ns: BASE_NS + 1_000 };

		const fromMemory = await inMemory.query(filter);
		const fromSqlite = await sqlite.query(filter);

		expect(titlesOf(fromSqlite)).toEqual(titlesOf(fromMemory));
		// C has no due_at_ns at all → excluded (not treated as "due at 0"). B's due date is past the
		// window → excluded. Only A and D have a due date strictly before the boundary.
		expect(titlesOf(fromMemory)).toEqual(["task-A-earliest-due-soonest", "task-D-latest-due-early"]);
	});

	it("all three combined narrow to the same single task on both adapters", async () => {
		const { inMemory, sqlite } = await buildAdapters();
		const filter: TaskFilter = {
			created_after_ns: BASE_NS,
			created_before_ns: BASE_NS + 7_000,
			due_before_ns: BASE_NS + 1_000,
		};

		const fromMemory = await inMemory.query(filter);
		const fromSqlite = await sqlite.query(filter);

		expect(titlesOf(fromSqlite)).toEqual(titlesOf(fromMemory));
		expect(titlesOf(fromMemory)).toEqual(["task-D-latest-due-early"]);
	});
});
