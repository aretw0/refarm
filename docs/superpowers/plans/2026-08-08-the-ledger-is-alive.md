# The Ledger Is Alive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the record of open work countable, per workspace, independent of where it is stored — so the node/workspace/sandbox/cost axes can be finished against a number instead of prose.

**Architecture:** A neutral `WorkItem` contract in `@refarm.dev/cli` with one built adapter (`project-json`), exercised by a single shared test suite against two genuinely divergent real-world shapes. A new workspace-scoped `refarm issues` command resolves through the node's declared catalog with no `process.cwd()` in the resolution path. `refarm resume` stops truncating silently. The CI gate gains an external anchor. The ~29 prose loose ends migrate into the ledger last, before the gate that requires them is switched on.

**Tech Stack:** TypeScript (`packages/cli`, `apps/refarm`), JavaScript (`packages/config`, `scripts/ci`), vitest.

**Spec:** `docs/superpowers/specs/2026-08-08-the-ledger-is-alive-design.md`

---

## FOOTGUNS — read before Task 1

These are ordered by how expensive they are to discover late.

1. **rcdc5 is a corporate repository. NEVER copy its content into this repo.** Task 2 needs rcdc5's
   *shape* (field names, id patterns, the `description` field) — **not its text**. Every fixture is
   synthetic content in rcdc5's shape. The only permitted contact with the real rcdc5 ledger is
   **read-only, at the live-proof step, printing counts only**. Do not `cat` its bodies into a commit
   message, a test, a doc, or a plan file. Refarm is a public-facing repository and rcdc5's issue
   bodies describe internal corporate systems.
2. **`normalizeDeclaredWorkspace` (`packages/config/src/workspaces-config.js:44`) DROPS unknown
   keys.** Declaring `issues` in `~/.refarm/config.json` without extending that function makes the
   declaration silently vanish — the command will report `provider: null` and you will debug the
   wrong layer. Task 3 exists solely because of this.
3. **NEVER write the `issues` declaration through `workspace add --replace`.** It rebuilds the entry
   from path/kind/execution/repository and **drops the `commands` map**
   (`packages/cli/src/workspace-declaration.ts:138-146`), which would destroy rcdc5's `vpn` and
   `code-boundaries` commands. Task 3's live step is a hand edit with a backup taken first.
4. **The hardening ratchet must not rise.** `node scripts/no-os-resolution.mjs` is at **117, delta
   0**. This plan adds path-resolution code, which is exactly what the ratchet counts. Run it before
   every commit and confirm `delta: 0`. A raised ceiling is a failed task, not a passing one.
5. **Task 6 before Task 5 breaks CI.** The blocking check requires every `next_actions` entry to cite
   a work-item id. Today all 24 cite none. Migrate first (Task 5), enable the gate second (Task 6).
   Doing it the other way blocks every commit including the fix.
6. **Never run `refarm ask`.** It spends the operator's real subscription quota.
7. **No Rust in this plan.** Never run a bare `cargo test` (OOM risk, `CLAUDE.md` §7). Do not rebuild
   the WASM agent. Do not run any `diagrams:` script. Do not restart the operator's node.
8. **`dist-load-smoke.test.ts` discovers top-level commands from `program` and loads them from
   `dist/`.** After Task 4 adds `refarm issues`, that test fails until
   `pnpm --filter @refarm.dev/refarm run build` has run. That is the build-to-verify cycle
   (`CLAUDE.md` §2), not a bug.
9. **No JSON Schema validator exists in this repo and this plan must not add one.** Validation is
   hand-written against the contract. Fields present in a document that the contract does not know
   are **reported as extras, never rejected** — that is how rcdc5's `description` survives.
10. **`apps/refarm` runs vitest with `--maxWorkers=1`.** Do not parallelise its tests.

## Global Constraints

- **Three states, never two.** Every quantity has an unknown. A workspace that cannot be read is a
  named `unreadable` bucket, never an omission and never a zero. An item with no `axis` is an
  `unclassified` row, never folded into a total. This follows `summariseObservations`
  (`apps/refarm/src/commands/budget.ts:118`), which already counts `unnamedNode`,
  `unidentifiedRecords` and `priceUnknown`.
- **No `process.cwd()` in any resolution path added by this plan.** Workspace resolution goes through
  `declaredBase()` (`packages/config/src/index.js:178`) → `loadConfig` → `declaredWorkspacesFromConfig`.
  A deliberate cwd read is permitted **only** for matching cwd against the declared catalog, and it
  must report `resolvedFrom: "cwd-match"` in the envelope.
- **Every JSON command exposes `ok`, `nextCommand`, `nextCommands.`** Use
  `buildJsonSuccessEnvelope` / `buildJsonErrorEnvelope` / `printJson` from
  `packages/capabilities/src/envelope.ts`, as `apps/refarm/src/commands/parity.ts` does.
- **No new dependency.** Node 22, no JSON Schema library, no cron library, nothing added to any
  `package.json` dependency block.
- **Ids are qualified across workspaces** as `<workspaceId>#<itemId>` (`refarm#ISS-023`). Unqualified
  ids are legal only inside a single-workspace command.
- **Do not change `.project/tasks.json`, `.project/requirements.json`, or their schemas.**
- Run `node scripts/no-os-resolution.mjs` before every commit; `delta: 0` is required.
- Run `refarm agent finish --lane after-edit --run --json` before committing and
  `--lane after-commit` after, per `CLAUDE.md` §4.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/cli/src/project-handoff.ts` | Report how much was truncated, per field. | 1 |
| `packages/cli/src/operator-resume.ts` | Carry `truncation` on the resume summary type. | 1 |
| `apps/refarm/src/commands/resume.ts:257` | Pass the total alongside the limit. | 1, 7 |
| `packages/cli/src/work-items/contract.ts` | The neutral `WorkItem` shape, the field list, the capability table type. Pure types + constants. | 2 |
| `packages/cli/src/work-items/project-json-adapter.ts` | Read/write a `.project/issues.json`-shaped document. | 2 |
| `packages/cli/src/work-items/adapter-contract.ts` | The shared suite every adapter must pass. | 2 |
| `packages/cli/src/work-items/project-json-adapter.test.ts` | Runs the shared suite twice, two shapes. | 2 |
| `packages/config/src/workspaces-config.js` | Carry the `issues` declaration through normalisation. | 3 |
| `packages/cli/src/work-items/resolve.ts` | Workspace → adapter, with `resolvedFrom` and refusals. | 4 |
| `apps/refarm/src/commands/issues.ts` | `list` / `add` / `set-status` / `validate`, workspace-scoped. | 4 |
| `apps/refarm/src/program.ts` | Register the command. | 4 |
| `.project/schemas/issues.schema.json` | Add `axis`. | 2 |
| `.project/issues.json`, `.project/handoff.json` | The migration itself. | 5 |
| `scripts/ci/project-block-consistency.mjs` | The two anchored checks. | 6 |

---

### Task 1: Truncation declares itself

**Files:**
- Modify: `packages/cli/src/project-handoff.ts:75` (`cleanStringArray`), `:100-108` (`parseProjectHandoffSummary`)
- Modify: `packages/cli/src/operator-resume.ts` (the `OperatorResumeProjectSummary` interface)
- Modify: `apps/refarm/src/commands/resume.ts:255-259` (`loadProjectHandoff`)
- Test: `packages/cli/src/project-handoff.test.ts`

**Interfaces:**
- Produces: `ProjectHandoffTruncation = Record<"currentTasks" | "blockers" | "nextActions" | "openQuestions", { returned: number; total: number }>` and a `truncation` property on `OperatorResumeProjectSummary`. Task 7 reads it.

- [ ] **Step 1: Write the failing tests**

Add to `packages/cli/src/project-handoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseProjectHandoffSummary } from "./project-handoff.js";

describe("parseProjectHandoffSummary truncation", () => {
	const base = { context: "c", timestamp: "2026-08-08T00:00:00Z", current_phase: "14" };

	it("reports the total when the limit cuts the list", () => {
		const summary = parseProjectHandoffSummary(
			{ ...base, next_actions: ["a", "b", "c", "d", "e", "f", "g"] },
			{ arrayLimit: 5 },
		);
		expect(summary?.nextActions).toHaveLength(5);
		expect(summary?.truncation.nextActions).toEqual({ returned: 5, total: 7 });
	});

	it("does not claim truncation at exactly the limit", () => {
		const summary = parseProjectHandoffSummary(
			{ ...base, next_actions: ["a", "b", "c", "d", "e"] },
			{ arrayLimit: 5 },
		);
		expect(summary?.truncation.nextActions).toEqual({ returned: 5, total: 5 });
	});

	it("counts the total before blanks are dropped, not after", () => {
		const summary = parseProjectHandoffSummary(
			{ ...base, blockers: ["a", "   ", "b"] },
			{ arrayLimit: 5 },
		);
		expect(summary?.blockers).toEqual(["a", "b"]);
		expect(summary?.truncation.blockers).toEqual({ returned: 2, total: 2 });
	});

	it("reports every field, including the ones that were not cut", () => {
		const summary = parseProjectHandoffSummary({ ...base }, { arrayLimit: 5 });
		expect(summary?.truncation).toEqual({
			currentTasks: { returned: 0, total: 0 },
			blockers: { returned: 0, total: 0 },
			nextActions: { returned: 0, total: 0 },
			openQuestions: { returned: 0, total: 0 },
		});
	});

	it("reports no truncation when no limit is given", () => {
		const summary = parseProjectHandoffSummary(
			{ ...base, next_actions: ["a", "b", "c", "d", "e", "f"] },
			{},
		);
		expect(summary?.nextActions).toHaveLength(6);
		expect(summary?.truncation.nextActions).toEqual({ returned: 6, total: 6 });
	});
});
```

Note the third test: `total` counts **cleaned** entries, so a blank line in the source is not
reported as hidden content. That is the difference between "19 items you cannot see" and "19 items,
some of which were whitespace".

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @refarm.dev/cli exec vitest run src/project-handoff.test.ts`
Expected: FAIL — `truncation` is undefined.

- [ ] **Step 3: Implement**

In `packages/cli/src/project-handoff.ts`, replace `cleanStringArray` and extend the parser:

```ts
export interface ProjectHandoffFieldCount {
	returned: number;
	total: number;
}

export interface ProjectHandoffTruncation {
	currentTasks: ProjectHandoffFieldCount;
	blockers: ProjectHandoffFieldCount;
	nextActions: ProjectHandoffFieldCount;
	openQuestions: ProjectHandoffFieldCount;
}

function cleanStringArray(value: unknown, limit?: number): string[] {
	return countedStringArray(value, limit).items;
}

function countedStringArray(
	value: unknown,
	limit?: number,
): { items: string[]; count: ProjectHandoffFieldCount } {
	if (!Array.isArray(value)) return { items: [], count: { returned: 0, total: 0 } };
	const cleaned = value.map(cleanString).filter((item): item is string => item !== undefined);
	const items = limit === undefined ? cleaned : cleaned.slice(0, limit);
	return { items, count: { returned: items.length, total: cleaned.length } };
}
```

and in `parseProjectHandoffSummary`:

```ts
	const currentTasks = countedStringArray(value.current_tasks, options.arrayLimit);
	const blockers = countedStringArray(value.blockers, options.arrayLimit);
	const nextActions = countedStringArray(value.next_actions, options.arrayLimit);
	const openQuestions = countedStringArray(value.open_questions, options.arrayLimit);
	return {
		path: options.path ?? PROJECT_HANDOFF_RELATIVE_PATH,
		timestamp,
		currentPhase,
		context,
		currentTasks: currentTasks.items,
		blockers: blockers.items,
		nextActions: nextActions.items,
		openQuestions: openQuestions.items,
		truncation: {
			currentTasks: currentTasks.count,
			blockers: blockers.count,
			nextActions: nextActions.count,
			openQuestions: openQuestions.count,
		},
	};
```

`cleanStringArray` is kept as a thin wrapper because `validateProjectHandoffDocument` still calls it;
do not delete it.

Add `truncation: ProjectHandoffTruncation;` to `OperatorResumeProjectSummary` in
`packages/cli/src/operator-resume.ts`, and export the two new types from wherever
`OperatorResumeProjectSummary` is exported.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @refarm.dev/cli exec vitest run src/project-handoff.test.ts`
Expected: PASS. Then `pnpm --filter @refarm.dev/cli run type-check` — expect no errors. If
`operator-resume.test.ts` fails on an object literal missing `truncation`, fix the fixture; do not
make the field optional.

- [ ] **Step 5: Prove it live against the operator's real handoff**

```bash
pnpm --filter @refarm.dev/cli run build && pnpm --filter @refarm.dev/refarm run build
refarm resume --json | python3 -c "import sys,json;print(json.load(sys.stdin)['project']['truncation'])"
```

Expected: `nextActions` and `currentTasks` both report `{'returned': 5, 'total': 24}`. **If your
numbers differ from 24, believe your measurement and report the disagreement** — the handoff may have
been rewritten since this plan was written.

- [ ] **Step 6: Commit**

```bash
node scripts/no-os-resolution.mjs   # must print delta: 0
refarm agent finish --lane after-edit --run --json
git add packages/cli/src/project-handoff.ts packages/cli/src/project-handoff.test.ts packages/cli/src/operator-resume.ts apps/refarm/src/commands/resume.ts
git commit -m "fix(resume): a truncated handoff read now says so"
refarm agent finish --lane after-commit --run --json
```

---

### Task 2: The work-item contract and the `project-json` adapter

**Files:**
- Create: `packages/cli/src/work-items/contract.ts`
- Create: `packages/cli/src/work-items/project-json-adapter.ts`
- Create: `packages/cli/src/work-items/adapter-contract.ts`
- Test: `packages/cli/src/work-items/project-json-adapter.test.ts`
- Modify: `.project/schemas/issues.schema.json` (add `axis`)

**Interfaces:**
- Produces: `WorkItem`, `WorkItemAxis`, `WorkItemStatus`, `FieldSupport`, `WORK_ITEM_FIELDS`, `CapabilityTable`, `WorkItemAdapter`, `WorkItemReadResult`, `WorkItemWriteResult`, `createProjectJsonAdapter(options)`, `describeAdapterContract(name, makeAdapter)`. Tasks 4, 6 and 7 consume these.

- [ ] **Step 1: Write `contract.ts` (types only, no logic)**

```ts
// The neutral shape. Adapters translate; the core never sees a backend's own record.
export const WORK_ITEM_STATUSES = ["open", "deferred", "resolved"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_AXES = [
	"node-vs-directory",
	"cost",
	"sandbox",
	"durability",
	"other",
] as const;
export type WorkItemAxis = (typeof WORK_ITEM_AXES)[number];

export const WORK_ITEM_FIELDS = [
	"id",
	"title",
	"body",
	"location",
	"status",
	"priority",
	"category",
	"package",
	"axis",
	"source",
	"resolvedBy",
] as const;
export type WorkItemField = (typeof WORK_ITEM_FIELDS)[number];

/** THREE STATES. `unsupported` is not `null` and not absent — it is a backend that cannot carry
 * this field at all, and the CLI must say so rather than drop the value silently. */
export type FieldSupport = "native" | "emulated" | "unsupported";
export type CapabilityTable = Readonly<Record<WorkItemField, FieldSupport>>;

export interface WorkItem {
	id: string;
	title: string;
	body: string;
	location: string;
	status: WorkItemStatus;
	priority: string;
	category: string;
	package: string;
	/** Absent means UNCLASSIFIED, which is a reportable row — never folded into a total. */
	axis?: WorkItemAxis;
	source?: string;
	resolvedBy?: string;
}

export interface WorkItemReadResult {
	ok: boolean;
	items: WorkItem[];
	/** Fields present in the backend document that this contract does not know. Reported, never
	 * rejected: rcdc5's ledger carries `description` and refarm's schema forbids it. */
	extraFields: string[];
	error: { reason: string; message: string } | null;
}

export interface WorkItemWriteResult {
	ok: boolean;
	item: WorkItem | null;
	error: { reason: string; message: string } | null;
}

export interface WorkItemAdapter {
	readonly provider: string;
	capabilities(): CapabilityTable;
	list(): WorkItemReadResult;
	add(item: WorkItem): WorkItemWriteResult;
	setStatus(id: string, status: WorkItemStatus, resolvedBy?: string): WorkItemWriteResult;
}

export function qualifyId(workspaceId: string, itemId: string): string {
	return `${workspaceId}#${itemId}`;
}

/** The capability guard lives HERE, not inside each adapter, so a backend cannot forget it and so
 * it is testable without a backend. Returns the fields the caller tried to write that this backend
 * declares it cannot carry. Empty array means the write is safe. */
export function rejectUnsupportedFields(
	capabilities: CapabilityTable,
	item: Partial<WorkItem>,
): WorkItemField[] {
	return WORK_ITEM_FIELDS.filter((field) => {
		const value = item[field];
		const present = typeof value === "string" ? value.trim().length > 0 : value !== undefined;
		return present && capabilities[field] === "unsupported";
	});
}
```

- [ ] **Step 2: Write the shared contract suite and the two fixtures**

Create `packages/cli/src/work-items/adapter-contract.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { WorkItem, WorkItemAdapter } from "./contract.js";

export interface AdapterContractFixture {
	/** An id that already exists in the backing document. */
	existingId: string;
	/** How many items the backing document holds. */
	count: number;
	/** A NEW item this backend must accept. */
	newItem: WorkItem;
	/** Fields the document carries that the contract does not know. */
	expectedExtraFields: string[];
}

/** EVERY adapter must pass this suite. A contract that passes with only one fixture has failed —
 * that is the whole reason this is a function and not a test file. */
export function describeAdapterContract(
	name: string,
	makeAdapter: () => WorkItemAdapter,
	fixture: AdapterContractFixture,
): void {
	describe(`work-item adapter contract: ${name}`, () => {
		it("lists every item in the document", () => {
			const result = makeAdapter().list();
			expect(result.ok).toBe(true);
			expect(result.items).toHaveLength(fixture.count);
			expect(result.error).toBeNull();
		});

		it("reports unknown fields as extras rather than failing", () => {
			const result = makeAdapter().list();
			expect(result.extraFields.sort()).toEqual([...fixture.expectedExtraFields].sort());
		});

		it("declares a support state for every contract field", () => {
			const table = makeAdapter().capabilities();
			for (const field of Object.values(table)) {
				expect(["native", "emulated", "unsupported"]).toContain(field);
			}
		});

		it("refuses a duplicate id instead of writing it", () => {
			const adapter = makeAdapter();
			const result = adapter.add({ ...fixture.newItem, id: fixture.existingId });
			expect(result.ok).toBe(false);
			expect(result.error?.reason).toBe("duplicate_id");
			expect(adapter.list().items).toHaveLength(fixture.count);
		});

		it("adds an item and reads it back", () => {
			const adapter = makeAdapter();
			expect(adapter.add(fixture.newItem).ok).toBe(true);
			const read = adapter.list();
			expect(read.items).toHaveLength(fixture.count + 1);
			expect(read.items.find((item) => item.id === fixture.newItem.id)?.title).toBe(
				fixture.newItem.title,
			);
		});

		it("refuses resolve without resolvedBy", () => {
			const adapter = makeAdapter();
			const result = adapter.setStatus(fixture.existingId, "resolved");
			expect(result.ok).toBe(false);
			expect(result.error?.reason).toBe("resolved_by_required");
		});

		it("resolves with resolvedBy", () => {
			const adapter = makeAdapter();
			const result = adapter.setStatus(fixture.existingId, "resolved", "abc1234");
			expect(result.ok).toBe(true);
			expect(result.item?.status).toBe("resolved");
			expect(result.item?.resolvedBy).toBe("abc1234");
		});

		it("refuses an unknown id", () => {
			const result = makeAdapter().setStatus("no-such-id-xyz", "deferred");
			expect(result.ok).toBe(false);
			expect(result.error?.reason).toBe("unknown_id");
		});

	});
}
```

The capability-degradation rule is NOT in this suite, deliberately: `project-json` supports every
field, so a suite test would silently early-return and prove nothing. It is tested directly against
`rejectUnsupportedFields` instead — add to `packages/cli/src/work-items/contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rejectUnsupportedFields } from "./contract.js";
import type { CapabilityTable } from "./contract.js";

const REMOTE_LIKE: CapabilityTable = {
	id: "native",
	title: "native",
	body: "native",
	location: "unsupported",   // GitHub has no location field — this is the real case
	status: "emulated",
	priority: "emulated",
	category: "emulated",
	package: "emulated",
	axis: "emulated",
	source: "unsupported",
	resolvedBy: "emulated",
};

describe("rejectUnsupportedFields", () => {
	it("names every unsupported field the caller tried to write", () => {
		expect(rejectUnsupportedFields(REMOTE_LIKE, { location: "a.ts:1", source: "agent" })).toEqual([
			"location",
			"source",
		]);
	});

	it("allows an unsupported field that is absent or blank", () => {
		expect(rejectUnsupportedFields(REMOTE_LIKE, { title: "t", location: "   " })).toEqual([]);
	});

	it("never rejects an emulated field — emulated is supported, just not natively", () => {
		expect(rejectUnsupportedFields(REMOTE_LIKE, { axis: "cost", status: "open" })).toEqual([]);
	});
});
```

The third test pins the distinction the three states exist for: `emulated` is a backend doing extra
work to keep a promise, not a backend refusing. Collapsing it into `unsupported` would make every
remote adapter reject `axis`, which is exactly the field the operator filters by.

- [ ] **Step 3: Run to verify the suite fails**

Run: `pnpm --filter @refarm.dev/cli exec vitest run src/work-items/`
Expected: FAIL — `project-json-adapter.js` does not exist yet.

- [ ] **Step 4: Implement the adapter**

Create `packages/cli/src/work-items/project-json-adapter.ts`. It takes injected IO so the tests need
no temp files:

```ts
import type {
	CapabilityTable,
	WorkItem,
	WorkItemAdapter,
	WorkItemReadResult,
	WorkItemStatus,
	WorkItemWriteResult,
} from "./contract.js";
import { WORK_ITEM_AXES, WORK_ITEM_STATUSES } from "./contract.js";

/** The document's own field names, which are snake_case where the contract is camelCase. */
const KNOWN_DOCUMENT_FIELDS = new Set([
	"id",
	"title",
	"body",
	"location",
	"status",
	"priority",
	"category",
	"package",
	"axis",
	"source",
	"resolved_by",
]);

const PROJECT_JSON_CAPABILITIES: CapabilityTable = Object.freeze({
	id: "native",
	title: "native",
	body: "native",
	location: "native",
	status: "native",
	priority: "native",
	category: "native",
	package: "native",
	axis: "native",
	source: "native",
	resolvedBy: "native",
});

export interface ProjectJsonAdapterOptions {
	readDocument: () => string;
	writeDocument: (contents: string) => void;
}

function toWorkItem(record: Record<string, unknown>): WorkItem {
	const status = WORK_ITEM_STATUSES.includes(record.status as WorkItemStatus)
		? (record.status as WorkItemStatus)
		: "open";
	const axisValue = record.axis;
	return {
		id: String(record.id ?? ""),
		title: String(record.title ?? ""),
		body: String(record.body ?? ""),
		location: String(record.location ?? ""),
		status,
		priority: String(record.priority ?? ""),
		category: String(record.category ?? ""),
		package: String(record.package ?? ""),
		axis: WORK_ITEM_AXES.includes(axisValue as never) ? (axisValue as WorkItem["axis"]) : undefined,
		source: typeof record.source === "string" ? record.source : undefined,
		resolvedBy: typeof record.resolved_by === "string" ? record.resolved_by : undefined,
	};
}

function toDocumentRecord(item: WorkItem): Record<string, unknown> {
	const record: Record<string, unknown> = {
		id: item.id,
		title: item.title,
		body: item.body,
		location: item.location,
		status: item.status,
		category: item.category,
		priority: item.priority,
		package: item.package,
	};
	if (item.axis) record.axis = item.axis;
	if (item.source) record.source = item.source;
	if (item.resolvedBy) record.resolved_by = item.resolvedBy;
	return record;
}

export function createProjectJsonAdapter(options: ProjectJsonAdapterOptions): WorkItemAdapter {
	function readRecords(): { records: Record<string, unknown>[]; extraFields: string[] } {
		const parsed = JSON.parse(options.readDocument()) as { issues?: unknown };
		const records = Array.isArray(parsed.issues)
			? (parsed.issues as Record<string, unknown>[])
			: [];
		const extras = new Set<string>();
		for (const record of records) {
			for (const key of Object.keys(record)) {
				if (!KNOWN_DOCUMENT_FIELDS.has(key)) extras.add(key);
			}
		}
		return { records, extraFields: [...extras].sort() };
	}

	function write(records: Record<string, unknown>[]): void {
		options.writeDocument(`${JSON.stringify({ issues: records }, null, "\t")}\n`);
	}

	return {
		provider: "project-json",
		capabilities: () => PROJECT_JSON_CAPABILITIES,

		list(): WorkItemReadResult {
			try {
				const { records, extraFields } = readRecords();
				return { ok: true, items: records.map(toWorkItem), extraFields, error: null };
			} catch (error) {
				return {
					ok: false,
					items: [],
					extraFields: [],
					error: {
						reason: "document_unreadable",
						message: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},

		add(item: WorkItem): WorkItemWriteResult {
			try {
				const { records } = readRecords();
				if (records.some((record) => String(record.id) === item.id)) {
					return {
						ok: false,
						item: null,
						error: { reason: "duplicate_id", message: `Work item ${item.id} already exists.` },
					};
				}
				write([...records, toDocumentRecord(item)]);
				return { ok: true, item, error: null };
			} catch (error) {
				return {
					ok: false,
					item: null,
					error: {
						reason: "document_unreadable",
						message: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},

		setStatus(id: string, status: WorkItemStatus, resolvedBy?: string): WorkItemWriteResult {
			if (status === "resolved" && !resolvedBy?.trim()) {
				return {
					ok: false,
					item: null,
					error: {
						reason: "resolved_by_required",
						message: "Resolving a work item requires --resolved-by <commit or reference>.",
					},
				};
			}
			try {
				const { records } = readRecords();
				const index = records.findIndex((record) => String(record.id) === id);
				if (index === -1) {
					return {
						ok: false,
						item: null,
						error: { reason: "unknown_id", message: `No work item with id ${id}.` },
					};
				}
				const updated = { ...records[index], status } as Record<string, unknown>;
				if (resolvedBy?.trim()) updated.resolved_by = resolvedBy.trim();
				const next = [...records];
				next[index] = updated;
				write(next);
				return { ok: true, item: toWorkItem(updated), error: null };
			} catch (error) {
				return {
					ok: false,
					item: null,
					error: {
						reason: "document_unreadable",
						message: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
	};
}
```

- [ ] **Step 5: Write the test file that runs the suite TWICE**

Create `packages/cli/src/work-items/project-json-adapter.test.ts`. **The rcdc5 fixture is
SYNTHETIC content in rcdc5's SHAPE** — see FOOTGUN 1. The shape facts being reproduced, measured on
2026-08-08: id namespace `issue-NNN` plus `fragility-fragility-<hash>`, and an eleventh field
`description` that refarm's schema forbids.

```ts
import { describeAdapterContract } from "./adapter-contract.js";
import { createProjectJsonAdapter } from "./project-json-adapter.js";
import type { WorkItem } from "./contract.js";

const REFARM_SHAPE = {
	issues: [
		{
			id: "ISS-001",
			title: "first",
			body: "b",
			location: "docs/A.md:1",
			status: "open",
			category: "cleanup",
			priority: "medium",
			package: "apps/refarm",
			axis: "node-vs-directory",
			source: "agent",
		},
		{
			id: "ISS-002",
			title: "second",
			body: "b",
			location: "docs/B.md:2",
			status: "resolved",
			category: "issue",
			priority: "low",
			package: "packages/cli",
			resolved_by: "deadbee",
		},
	],
};

/** rcdc5's SHAPE, not rcdc5's CONTENT. Two id namespaces and the extra `description` field. */
const RCDC5_SHAPE = {
	issues: [
		{
			id: "issue-001",
			title: "first",
			description: "a field refarm's schema forbids",
			body: "b",
			location: "src/x.ts:10",
			status: "open",
			category: "cleanup",
			priority: "high",
			package: "some-package",
		},
		{
			id: "fragility-fragility-abc123",
			title: "second",
			description: "again",
			body: "b",
			location: "src/y.ts:20",
			status: "open",
			category: "issue",
			priority: "medium",
			package: "some-package",
		},
		{
			id: "issue-002",
			title: "third",
			body: "b",
			location: "src/z.ts:30",
			status: "resolved",
			category: "issue",
			priority: "low",
			package: "some-package",
			resolved_by: "cafe123",
		},
	],
};

function newItem(id: string): WorkItem {
	return {
		id,
		title: "added",
		body: "body",
		location: "docs/NEW.md:1",
		status: "open",
		priority: "medium",
		category: "cleanup",
		package: "packages/cli",
		axis: "cost",
	};
}

function inMemoryAdapter(seed: object) {
	let contents = JSON.stringify(seed);
	return createProjectJsonAdapter({
		readDocument: () => contents,
		writeDocument: (next) => {
			contents = next;
		},
	});
}

describeAdapterContract("project-json / refarm shape", () => inMemoryAdapter(REFARM_SHAPE), {
	existingId: "ISS-001",
	count: 2,
	newItem: newItem("ISS-900"),
	expectedExtraFields: [],
});

describeAdapterContract("project-json / rcdc5 shape", () => inMemoryAdapter(RCDC5_SHAPE), {
	existingId: "issue-001",
	count: 3,
	newItem: newItem("issue-900"),
	expectedExtraFields: ["description"],
});
```

- [ ] **Step 6: Run to verify both suites pass**

Run: `pnpm --filter @refarm.dev/cli exec vitest run src/work-items/`
Expected: PASS, **both** described suites. If only the refarm one passes, the contract is wrong, not
the fixture.

- [ ] **Step 7: Add `axis` to refarm's own schema**

In `.project/schemas/issues.schema.json`, inside `properties`, add:

```json
					"axis": {
						"type": "string",
						"enum": ["node-vs-directory", "cost", "sandbox", "durability", "other"],
						"description": "Which axis of open work this item belongs to. Optional in the schema; required by the CI gate for status: open."
					},
```

Do **not** add it to `required`, and do **not** touch rcdc5's schema (see FOOTGUN 1).

- [ ] **Step 8: Commit**

```bash
node scripts/no-os-resolution.mjs   # delta: 0
refarm agent finish --lane after-edit --run --json
git add packages/cli/src/work-items/ .project/schemas/issues.schema.json
git commit -m "feat(work-items): a neutral contract, proven against two divergent real shapes"
refarm agent finish --lane after-commit --run --json
```

---

### Task 3: The workspace declares where its work items live

**Files:**
- Modify: `packages/config/src/workspaces-config.js:44` (`normalizeDeclaredWorkspace`)
- Test: `packages/config/src/workspaces-config.test.js` (create if absent)

**Interfaces:**
- Produces: `DeclaredWorkspace.issues` = `{ provider: string; path: string } | null`. Task 4 consumes it.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, expect, it } from "vitest";
import { declaredWorkspacesFromConfig } from "./workspaces-config.js";

describe("declared workspace issues block", () => {
	it("carries a declared issues block through normalisation", () => {
		const [workspace] = declaredWorkspacesFromConfig(
			{ workspaces: { a: { path: "/w/a", issues: { provider: "project-json", path: ".project/issues.json" } } } },
			{ baseDir: "/base" },
		);
		expect(workspace.issues).toEqual({ provider: "project-json", path: ".project/issues.json" });
	});

	it("is null when undeclared — never a guess", () => {
		const [workspace] = declaredWorkspacesFromConfig(
			{ workspaces: { a: { path: "/w/a" } } },
			{ baseDir: "/base" },
		);
		expect(workspace.issues).toBeNull();
	});

	it("is null when the block is malformed rather than half-normalised", () => {
		const [workspace] = declaredWorkspacesFromConfig(
			{ workspaces: { a: { path: "/w/a", issues: { provider: 42 } } } },
			{ baseDir: "/base" },
		);
		expect(workspace.issues).toBeNull();
	});

	it("does not drop the commands map when issues is present", () => {
		const [workspace] = declaredWorkspacesFromConfig(
			{ workspaces: { a: { path: "/w/a", commands: { vpn: { run: ["true"] } }, issues: { provider: "project-json", path: "p.json" } } } },
			{ baseDir: "/base" },
		);
		expect(Object.keys(workspace.commands)).toContain("vpn");
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @refarm.dev/config exec vitest run src/workspaces-config.test.js`
Expected: FAIL — `workspace.issues` is `undefined`.

- [ ] **Step 3: Implement**

In `packages/config/src/workspaces-config.js`, add above `normalizeDeclaredWorkspace`:

```js
const WORK_ITEM_PROVIDERS = Object.freeze(["project-json"]);

function normalizeWorkspaceIssues(value) {
	if (!isRecord(value)) return null;
	const provider = typeof value.provider === "string" ? value.provider.trim() : "";
	if (!WORK_ITEM_PROVIDERS.includes(provider)) return null;
	const declaredPath = typeof value.path === "string" && value.path.trim() ? value.path.trim() : ".project/issues.json";
	return { provider, path: declaredPath };
}
```

and inside `normalizeDeclaredWorkspace`, add `const issues = normalizeWorkspaceIssues(value.issues);`
and `issues,` to the returned object.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @refarm.dev/config exec vitest run src/workspaces-config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
node scripts/no-os-resolution.mjs   # delta: 0
refarm agent finish --lane after-edit --run --json
git add packages/config/src/workspaces-config.js packages/config/src/workspaces-config.test.js
git commit -m "feat(config): a workspace declares where its work items live"
refarm agent finish --lane after-commit --run --json
```

---

### Task 4: `refarm issues` — workspace-scoped, never positional

**Files:**
- Create: `packages/cli/src/work-items/resolve.ts`
- Create: `apps/refarm/src/commands/issues.ts`
- Create: `apps/refarm/test/commands/issues.test.ts`
- Modify: `apps/refarm/src/program.ts` (import + `program.addCommand(issuesCommand)`)

**Interfaces:**
- Consumes: `createProjectJsonAdapter`, `WorkItem`, `qualifyId` (Task 2); `DeclaredWorkspace.issues` (Task 3); `declaredBase` from `@refarm.dev/config`.
- Produces: `resolveWorkspaceLedger(input): LedgerResolution` where
  `LedgerResolution = { ok: true; workspaceId: string; resolvedFrom: "flag" | "cwd-match" | "convention"; provider: string; adapter: WorkItemAdapter } | { ok: false; reason: "no_such_workspace" | "cwd_unmatched" | "no_provider"; declared: string[] }`. Task 7 consumes it.

- [ ] **Step 1: Write the failing tests for resolution**

Create `apps/refarm/test/commands/issues.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveWorkspaceLedger } from "@refarm.dev/cli";

const CATALOG = [
	{ id: "refarm", absolutePath: "/home/op/github/refarm", issues: { provider: "project-json", path: ".project/issues.json" } },
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5/rcdc5", issues: null },
];

const deps = {
	loadWorkspaces: () => CATALOG,
	fileExists: (p: string) => p === "/home/op/git/rcdc5/rcdc5/.project/issues.json",
	readDocument: () => JSON.stringify({ issues: [] }),
	writeDocument: () => {},
};

describe("resolveWorkspaceLedger", () => {
	it("resolves from the flag and says so", () => {
		const result = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: true, workspaceId: "refarm", resolvedFrom: "flag" });
	});

	it("gives the same answer from any directory", () => {
		const a = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/tmp", ...deps });
		const b = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/home/op/git/rcdc5/rcdc5", ...deps });
		expect(a).toEqual(b);
	});

	it("matches cwd against the catalog and declares the inference", () => {
		const result = resolveWorkspaceLedger({ cwd: "/home/op/github/refarm/docs", ...deps });
		expect(result).toMatchObject({ ok: true, workspaceId: "refarm", resolvedFrom: "cwd-match" });
	});

	it("infers project-json by convention when undeclared but present, and says so", () => {
		const result = resolveWorkspaceLedger({ workspace: "rcdc5", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: true, provider: "project-json", resolvedFrom: "convention" });
	});

	it("refuses an unmatched cwd and lists the declared workspaces — never reads ./.project", () => {
		const result = resolveWorkspaceLedger({ cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: false, reason: "cwd_unmatched", declared: ["refarm", "rcdc5"] });
	});

	it("refuses an unknown workspace id", () => {
		const result = resolveWorkspaceLedger({ workspace: "nope", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: false, reason: "no_such_workspace" });
	});

	it("reports no provider when neither declaration nor convention applies", () => {
		const result = resolveWorkspaceLedger({
			workspace: "rcdc5",
			cwd: "/tmp",
			...deps,
			fileExists: () => false,
		});
		expect(result).toMatchObject({ ok: false, reason: "no_provider" });
	});
});
```

The second test is the one that matters most: it is the directory-independence guarantee expressed as
a unit test, and it is what `refarm project` fails today.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run test/commands/issues.test.ts`
Expected: FAIL — `resolveWorkspaceLedger` is not exported.

- [ ] **Step 3: Implement the resolver**

Create `packages/cli/src/work-items/resolve.ts`:

```ts
import path from "node:path";
import type { WorkItemAdapter } from "./contract.js";
import { createProjectJsonAdapter } from "./project-json-adapter.js";

const CONVENTION_PATH = ".project/issues.json";

export interface LedgerWorkspace {
	id: string;
	absolutePath: string;
	issues: { provider: string; path: string } | null;
}

export interface ResolveLedgerInput {
	workspace?: string;
	/** A DELIBERATE cwd read, used ONLY to match against the declared catalog, and always reported
	 * as `resolvedFrom: "cwd-match"`. It is never a path the ledger is read from. */
	cwd: string;
	loadWorkspaces: () => LedgerWorkspace[];
	fileExists: (candidate: string) => boolean;
	readDocument: (candidate: string) => string;
	writeDocument: (candidate: string, contents: string) => void;
}

export type LedgerResolution =
	| {
			ok: true;
			workspaceId: string;
			resolvedFrom: "flag" | "cwd-match" | "convention";
			provider: string;
			documentPath: string;
			adapter: WorkItemAdapter;
	  }
	| { ok: false; reason: "no_such_workspace" | "cwd_unmatched" | "no_provider"; declared: string[] };

function isInside(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveWorkspaceLedger(input: ResolveLedgerInput): LedgerResolution {
	const workspaces = input.loadWorkspaces();
	const declared = workspaces.map((workspace) => workspace.id).sort();

	let workspace: LedgerWorkspace | undefined;
	let origin: "flag" | "cwd-match";
	if (input.workspace) {
		workspace = workspaces.find((candidate) => candidate.id === input.workspace);
		if (!workspace) return { ok: false, reason: "no_such_workspace", declared };
		origin = "flag";
	} else {
		// LONGEST match wins, so a nested workspace is not shadowed by its parent.
		workspace = workspaces
			.filter((candidate) => isInside(candidate.absolutePath, input.cwd))
			.sort((left, right) => right.absolutePath.length - left.absolutePath.length)[0];
		if (!workspace) return { ok: false, reason: "cwd_unmatched", declared };
		origin = "cwd-match";
	}

	let provider = workspace.issues?.provider;
	let relativePath = workspace.issues?.path;
	let resolvedFrom: "flag" | "cwd-match" | "convention";
	if (provider && relativePath) {
		resolvedFrom = origin;
	} else if (input.fileExists(path.join(workspace.absolutePath, CONVENTION_PATH))) {
		provider = "project-json";
		relativePath = CONVENTION_PATH;
		resolvedFrom = "convention";
	} else {
		return { ok: false, reason: "no_provider", declared };
	}

	const documentPath = path.join(workspace.absolutePath, relativePath);
	return {
		ok: true,
		workspaceId: workspace.id,
		resolvedFrom,
		provider,
		documentPath,
		adapter: createProjectJsonAdapter({
			readDocument: () => input.readDocument(documentPath),
			writeDocument: (contents) => input.writeDocument(documentPath, contents),
		}),
	};
}
```

Export `resolveWorkspaceLedger`, `createProjectJsonAdapter` and the contract types from
`packages/cli/src/index.ts` (follow how `parseProjectHandoffSummary` is exported there).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @refarm.dev/cli run build && pnpm --filter @refarm.dev/refarm exec vitest run test/commands/issues.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the command**

Create `apps/refarm/src/commands/issues.ts`. The default workspace loader uses `declaredBase()` and
**no `process.cwd()`**:

```ts
import { Command } from "commander";
import fs from "node:fs";
import chalk from "chalk";
import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities";
import { declaredBase, declaredWorkspacesFromConfig, loadConfig } from "@refarm.dev/config";
import { qualifyId, resolveWorkspaceLedger, WORK_ITEM_AXES } from "@refarm.dev/cli";

function defaultLoadWorkspaces() {
	const baseDir = declaredBase();
	return declaredWorkspacesFromConfig(loadConfig(baseDir), { baseDir });
}

const io = {
	loadWorkspaces: defaultLoadWorkspaces,
	fileExists: (candidate: string) => fs.existsSync(candidate),
	readDocument: (candidate: string) => fs.readFileSync(candidate, "utf-8"),
	writeDocument: (candidate: string, contents: string) => fs.writeFileSync(candidate, contents),
};
```

The shape every subcommand shares — a refusal is an envelope, never a throw:

```ts
function refuse(operation: string, resolution: { reason: string; declared: string[] }, json?: boolean) {
	const message = {
		no_such_workspace: `No declared workspace with that id. Declared: ${resolution.declared.join(", ")}`,
		cwd_unmatched: `This directory is inside no declared workspace. Declared: ${resolution.declared.join(", ")}. Pass --workspace <id>.`,
		no_provider: "This workspace declares no work-item provider and has no .project/issues.json.",
	}[resolution.reason] ?? resolution.reason;
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "issues",
				operation,
				error: resolution.reason,
				message,
				nextAction: "refarm workspace list --json",
			}),
		);
	} else {
		console.error(chalk.red(message));
	}
	process.exitCode = 1;
}
```

`list` — the one that answers the operator's question:

```ts
command
	.command("list")
	.description("List a workspace's open work items")
	.option("--workspace <id>", "Declared workspace id")
	.option("--all-workspaces", "Every declared workspace, grouped and never merged")
	.option("--axis <axis>", `Filter by axis: ${WORK_ITEM_AXES.join(", ")}`)
	.option("--status <status>", "Filter by status: open, deferred, or resolved")
	.option("--json", "Output machine-readable list")
	.action((options) => {
		const cwd = process.cwd();   // DELIBERATE: matched against the catalog, never read from.
		const groups: Record<string, unknown> = {};
		const unreadable: Record<string, unknown> = {};
		const targets = options.allWorkspaces
			? io.loadWorkspaces().map((workspace) => workspace.id)
			: [options.workspace];

		for (const target of targets) {
			const resolution = resolveWorkspaceLedger({ workspace: target, cwd, ...io });
			if (!resolution.ok) {
				if (!options.allWorkspaces) return refuse("list", resolution, options.json);
				unreadable[target] = { reason: resolution.reason };
				continue;
			}
			const read = resolution.adapter.list();
			if (!read.ok) {
				unreadable[resolution.workspaceId] = read.error;
				continue;
			}
			const items = read.items
				.filter((item) => (options.status ? item.status === options.status : item.status === "open"))
				.filter((item) => (options.axis ? item.axis === options.axis : true));
			groups[resolution.workspaceId] = {
				provider: resolution.provider,
				resolvedFrom: resolution.resolvedFrom,
				count: items.length,
				unclassified: items.filter((item) => !item.axis).length,
				extraFields: read.extraFields,
				capabilities: resolution.adapter.capabilities(),
				items: items.map((item) => ({ ...item, qualifiedId: qualifyId(resolution.workspaceId, item.id) })),
			};
		}

		if (options.json) {
			printJson(
				buildJsonSuccessEnvelope({
					command: "issues",
					operation: "list",
					nextCommands: [],
					extra: options.allWorkspaces
						? { workspaces: groups, unreadable }
						: Object.values(groups)[0] ?? {},
				}),
			);
			return;
		}
		for (const [id, group] of Object.entries(groups)) {
			const typed = group as { count: number; unclassified: number };
			console.log(`${id}: ${typed.count} open (${typed.unclassified} unclassified)`);
		}
		for (const [id, reason] of Object.entries(unreadable)) {
			console.log(chalk.yellow(`${id}: unreadable — ${JSON.stringify(reason)}`));
		}
	});
```

Note `unreadable` is populated only in `--all-workspaces`; a single-workspace failure is a refusal
with a non-zero exit, because there is no partial answer to give.

`add` requires `--id`, `--title`, `--body`, `--location`, `--category`, `--priority`, `--package`,
and accepts `--axis` and `--dry-run`. Before calling `adapter.add`, it calls
`rejectUnsupportedFields(adapter.capabilities(), item)` and refuses with `error: "field_unsupported"`
listing the fields if the array is non-empty. `set-status` requires `--id` and `--status`, and passes
`--resolved-by` through; the adapter already refuses `resolved` without it. Both refuse before
writing, never after.

- [ ] **Step 6: Register and prove it live**

In `apps/refarm/src/program.ts`: `import { issuesCommand } from "./commands/issues.js";` and
`program.addCommand(issuesCommand);` beside `program.addCommand(projectCommand);` (line 342).

**Declare the two workspaces' ledgers — by hand, with a backup (FOOTGUN 3):**

```bash
cp ~/.refarm/config.json ~/.refarm/config.json.bak-$(date +%Y%m%d%H%M%S)
# then add, to BOTH the "refarm" and "rcdc5" entries, without touching their "commands" maps:
#   "issues": { "provider": "project-json", "path": ".project/issues.json" }
node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.refarm/config.json','utf8'));console.log('json ok')"
node -e "const w=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.refarm/config.json','utf8')).workspaces;for(const [k,v] of Object.entries(w))console.log(k,'commands:',Object.keys(v.commands??{}).join(',')||'NONE','issues:',JSON.stringify(v.issues))"
```

The second command is the guard: if either workspace lost its `commands`, restore the backup.

```bash
pnpm --filter @refarm.dev/cli run build && pnpm --filter @refarm.dev/refarm run build
for d in /home/s095407044/github/refarm /home/s095407044/git/rcdc5/rcdc5 /tmp; do
  (cd "$d" && refarm issues list --all-workspaces --json | python3 -c "import sys,json;d=json.load(sys.stdin);print({k:v['count'] for k,v in d['workspaces'].items()}, 'unreadable:', list(d.get('unreadable',{})))")
done
```

Expected: **identical output from all three directories** — `{'refarm': 22, 'rcdc5': 28}` as measured
on 2026-08-08 — and an empty `unreadable`. **This is a read-only step against rcdc5; do not write to
it and do not paste its item bodies anywhere.** If your counts differ, believe your measurement.

- [ ] **Step 7: Run the full affected suites**

Run: `pnpm --filter @refarm.dev/refarm run test && pnpm --filter @refarm.dev/refarm run type-check`
Expected: PASS, including `test/architecture/dist-load-smoke.test.ts` (which needs the build from
Step 6 — FOOTGUN 8).

- [ ] **Step 8: Commit**

```bash
node scripts/no-os-resolution.mjs   # delta: 0
refarm agent finish --lane after-edit --run --json
git add packages/cli/src/work-items/resolve.ts packages/cli/src/index.ts apps/refarm/src/commands/issues.ts apps/refarm/test/commands/issues.test.ts apps/refarm/src/program.ts
git commit -m "feat(issues): work items resolve through the declared catalog, not the cwd"
refarm agent finish --lane after-commit --run --json
```

---

### Task 5: The migration — ~29 prose loose ends become addressable

**Files:**
- Modify: `.project/issues.json` (append `ISS-023`…)
- Modify: `.project/handoff.json` (`next_actions`, `blockers` rewritten to cite ids)
- Create: `docs/WORK_ITEM_LEDGER.md`

**Interfaces:** Consumes `refarm issues add` from Task 4.

- [ ] **Step 1: Extract the inventory**

Read `.project/handoff.json` **directly with the Read tool, not through `refarm resume`** — resume
truncates by design (Task 1 makes it say so, it does not make it complete). Build the inventory from
four fields: `next_actions` (15 named items), `blockers` (4), `open_questions` (6), and the sandbox
items named inside the `current_tasks` "SHIPPED" narratives (4).

Two items are recorded as **both resolved and still-open** (spec §7). Do not guess which. Measure:

```bash
git log --oneline -1 f98a799a                      # the workspace-sync claim
grep -n "process.cwd\|declaredBase" packages/cli/src/workspace-sync.ts | head
grep -n -A6 "export function declaredBase" packages/config/src/index.js
```

Record the verdict and the command that produced it in the item's `body`.

One blocker is **stale**: the requirements-interview one. `git show --stat 80df1537` proves
`docs/OPERATOR_REQUIREMENTS.md` exists. It is migrated with `status: "resolved"` and
`resolved_by: "80df1537"`, not deleted — a stale blocker that vanishes without a record teaches
nothing.

- [ ] **Step 2: Add each item**

One `refarm issues add` per item, `--axis` from the spec's four (`other` for anything that fits none).
Each `--body` carries the **full original prose**, so nothing is lost — this is relocation. Each
`--location` carries the file and line the prose already names.

```bash
refarm issues add --workspace refarm --id ISS-023 --axis node-vs-directory \
  --title "config_node.rs declared_base() is a second Rust resolver that falls back to current_dir()" \
  --location "packages/tractor/src/host/plugin_host/config_node.rs:48-55" \
  --category cleanup --priority high --package packages/tractor \
  --body "<the full paragraph from next_actions[1](a), verbatim>"
```

- [ ] **Step 3: Verify the count and the classification**

```bash
refarm issues list --workspace refarm --status open --json | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('open:', d['count'], '| unclassified:', d['unclassified'])
from collections import Counter; print(Counter(i.get('axis','(none)') for i in d['items']))"
```

Expected: `unclassified: 0` and a per-axis breakdown summing to `open`. **The per-axis numbers are
produced here; they were never asserted in advance** (spec: "shape, not measurement").

- [ ] **Step 4: Rewrite the handoff to cite ids**

Every remaining `next_actions` and `blockers` entry must cite at least one `ISS-` id, and must be
**short** — the narrative of what this slice is about, with the detail living in the item. This is
what makes Task 6's gate passable. Then:

```bash
refarm project handoff validate --json
```

- [ ] **Step 5: Document the ledger**

Create `docs/WORK_ITEM_LEDGER.md` with exactly these sections, and link it from `docs/INDEX.md`:

1. **What a work item is, and what it is not** — named debt not yet scheduled; a `tasks.json` task is
   scheduled work inside a plan; an item becomes a task when a plan adopts it.
2. **The four axes**, one line each on what belongs in it, plus `other` and when to use it.
3. **The four commands**, with a runnable example of each, including `--all-workspaces`.
4. **Why ids are qualified** — the measured fact that refarm uses `ISS-` and rcdc5 uses `issue-` and
   `fragility-fragility-<hash>`, so non-collision today is naming luck, not design.
5. **The capability table and its three states** — `native` / `emulated` / `unsupported`, and the
   GitHub/GitLab mapping table copied from the spec, marked *designed, not built*.
6. **What the gate enforces**, both directions, and the reverse rule that was deliberately rejected
   and why.
7. **How the ledger died the first time** — the CLI-writer-as-life-support finding, so the next
   person understands the gate is not bureaucracy.

- [ ] **Step 6: Commit**

```bash
node scripts/no-os-resolution.mjs   # delta: 0
refarm agent finish --lane after-edit --run --json
git add .project/issues.json .project/handoff.json docs/WORK_ITEM_LEDGER.md docs/INDEX.md
git commit -m "docs(ledger): the loose ends become countable"
refarm agent finish --lane after-commit --run --json
```

---

### Task 6: The gate learns a third state

**Files:**
- Modify: `scripts/ci/project-block-consistency.mjs`
- Create: `scripts/ci/project-block-consistency.test.mjs`
- Modify: `package.json` (register `project:validate:test`)
- Modify: `.github/workflows/test.yml` (run the new test beside the existing gate)

**Interfaces:** Consumes the migrated `.project/issues.json` and `.project/handoff.json` from Task 5.
**Do not start this task until Task 5 is committed** (FOOTGUN 5).

**RUNNER — this task does NOT use vitest.** Vitest's `include` is
`["**/*.test.ts", "**/*.spec.ts", "**/*.test.js", "**/*.spec.js"]`
(`packages/vtconfig/src/index.js:195`) — **`.mjs` is not in it**, so a vitest invocation would
silently run nothing. Every `scripts/*.test.mjs` in this repo runs under `node --test` and is
registered as a `package.json` script wired into CI (`no-os-resolution:test`, `.github/workflows/test.yml:1077`).
Follow that convention exactly; a test that exists but never runs is the same silent-success defect
this whole plan is about.

**THE GATE IS ALREADY WIRED IN THREE PLACES** — `.github/workflows/test.yml:469`,
`package.json`'s `gate:full:colony`, and `scripts/ci-local.sh:126`. `gate:full:colony` invokes it
with `--silent`, so the new **warnings must respect `--silent`** exactly as the existing output does.
Errors are never silenced.

- [ ] **Step 1: Write the failing tests**

Extract the two new checks as pure exported functions so they are testable without a filesystem.
Create `scripts/ci/project-block-consistency.test.mjs` using **`node:test`**, matching
`scripts/no-os-resolution.test.mjs`:

```js
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkHandoffCitations, checkLedgerFreshness } from "./project-block-consistency.mjs";

describe("checkHandoffCitations", () => {
	const issues = [{ id: "ISS-001", status: "open", axis: "cost" }];

	it("errors when a cited id does not exist", () => {
		const result = checkHandoffCitations({ next_actions: ["see ISS-404"], blockers: [] }, issues);
		assert.ok(result.errors.includes("[handoff] cites unknown work item: ISS-404"));
	});

	it("errors when an entry cites nothing", () => {
		const result = checkHandoffCitations(
			{ next_actions: ["a loose end with no id"], blockers: [] },
			issues,
		);
		assert.equal(result.errors.length, 1);
		assert.match(result.errors[0], /cites no work item/);
	});

	it("passes when every entry cites an existing id", () => {
		const result = checkHandoffCitations({ next_actions: ["ISS-001 is next"], blockers: [] }, issues);
		assert.deepEqual(result.errors, []);
	});

	it("does NOT require every open issue to appear in the handoff", () => {
		const many = [
			{ id: "ISS-001", status: "open", axis: "cost" },
			{ id: "ISS-002", status: "open", axis: "cost" },
		];
		const result = checkHandoffCitations({ next_actions: ["ISS-001 only"], blockers: [] }, many);
		assert.deepEqual(result.errors, []);
	});

	it("errors on an open issue with no axis", () => {
		const result = checkHandoffCitations({ next_actions: ["ISS-001"], blockers: [] }, [
			{ id: "ISS-001", status: "open" },
		]);
		assert.match(result.errors.join(" "), /ISS-001.*axis/);
	});

	it("errors on a resolved issue with no resolved_by", () => {
		const result = checkHandoffCitations({ next_actions: ["ISS-001"], blockers: [] }, [
			{ id: "ISS-001", status: "open", axis: "cost" },
			{ id: "ISS-002", status: "resolved" },
		]);
		assert.match(result.errors.join(" "), /ISS-002.*resolved_by/);
	});
});

describe("checkLedgerFreshness", () => {
	it("warns, never errors, when commits landed and the ledger did not move", () => {
		const result = checkLedgerFreshness({ commitsSinceLedgerChange: 12 });
		assert.deepEqual(result.errors, []);
		assert.equal(result.warnings.length, 1);
	});

	it("is silent when the ledger moved recently", () => {
		const result = checkLedgerFreshness({ commitsSinceLedgerChange: 0 });
		assert.deepEqual(result.warnings, []);
	});

	it("reports unknown rather than fresh when git cannot be read", () => {
		const result = checkLedgerFreshness({ commitsSinceLedgerChange: null });
		assert.match(result.warnings.join(" "), /unknown/);
		assert.deepEqual(result.errors, []);
	});
});
```

Note the fourth citation test now gives both issues an `axis` — without it the test would pass for
the wrong reason, tripping the open-issue-needs-axis rule instead of proving the reverse rule is
absent.

The fourth citation test and the third freshness test are the load-bearing ones: they pin the two
decisions that are easiest to "improve" into a deadlock later.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/ci/project-block-consistency.test.mjs`
Expected: FAIL — the functions are not exported.

- [ ] **Step 3: Implement**

Add to `scripts/ci/project-block-consistency.mjs`, exported, and call them from `main()` — errors into
`errors`, warnings into `warnings`, using the arrays that already exist there:

```js
const CITATION = /\bISS-\d+\b/g;

export function checkHandoffCitations(handoff, issues) {
	const errors = [];
	const ids = new Set(issues.map((issue) => issue.id));
	const entries = [
		...asArray(handoff.next_actions).map((text) => ["next_actions", text]),
		...asArray(handoff.blockers).map((text) => ["blockers", text]),
	];

	for (const [field, text] of entries) {
		const cited = String(text).match(CITATION) ?? [];
		if (cited.length === 0) {
			errors.push(`[handoff] ${field} entry cites no work item: ${String(text).slice(0, 60)}…`);
			continue;
		}
		for (const id of cited) {
			if (!ids.has(id)) errors.push(`[handoff] cites unknown work item: ${id}`);
		}
	}

	for (const issue of issues) {
		if (issue.status === "open" && !issue.axis) {
			errors.push(`[issues] ${issue.id} is open with no axis`);
		}
		if (issue.status === "resolved" && !issue.resolved_by) {
			errors.push(`[issues] ${issue.id} is resolved with no resolved_by`);
		}
	}

	return { errors };
}

export function checkLedgerFreshness({ commitsSinceLedgerChange }) {
	if (commitsSinceLedgerChange === null) {
		return { errors: [], warnings: ["[ledger] freshness unknown — git history unreadable"] };
	}
	if (commitsSinceLedgerChange > 0) {
		return {
			errors: [],
			warnings: [
				`[ledger] ${commitsSinceLedgerChange} commit(s) since .project/issues.json last changed`,
			],
		};
	}
	return { errors: [], warnings: [] };
}
```

The git anchor, in `main()` only — never inside the pure functions. Add
`import { execFileSync } from "node:child_process";` to the top of the file, beside the existing
`node:fs` import:

```js
function commitsSinceLedgerChange() {
	try {
		const last = execFileSync("git", ["log", "-1", "--format=%H", "--", ".project/issues.json"], {
			encoding: "utf8",
		}).trim();
		if (!last) return null;
		const count = execFileSync("git", ["rev-list", "--count", `${last}..HEAD`], { encoding: "utf8" });
		return Number.parseInt(count.trim(), 10);
	} catch {
		return null;   // UNKNOWN, never 0 — a shallow clone is not a fresh ledger.
	}
}
```

- [ ] **Step 4: Register the test in both places it must run**

A test nobody runs is the defect this plan exists to end. In `package.json`, beside
`"project:validate"` (line 95):

```json
		"project:validate:test": "node --test scripts/ci/project-block-consistency.test.mjs",
```

and in `.github/workflows/test.yml`, in the same step block as the existing
`node scripts/ci/project-block-consistency.mjs` (line 469), add a step running
`pnpm run project:validate:test`. Follow the shape of the `no-os-resolution:test` step
(`test.yml:1077`) exactly — same runner, same registration pattern.

- [ ] **Step 5: Run to verify they pass, then run the gate for real, both ways**

```bash
node --test scripts/ci/project-block-consistency.test.mjs
node scripts/ci/project-block-consistency.mjs
node scripts/ci/project-block-consistency.mjs --silent   # warnings must be suppressed, errors never
pnpm run project:validate:test
```

Expected: tests PASS, and the real gate **passes** — because Task 5 migrated first. If it errors on
uncited handoff entries, Task 5 is incomplete; finish it rather than weakening the check.

Then prove the gate actually bites — this is the one check that matters most:

```bash
python3 - <<'PY'
import json
p=".project/handoff.json"
d=json.load(open(p))
d["next_actions"].append("a new loose end with no work item id")
json.dump(d,open(p,"w"),indent="\t",ensure_ascii=False)
PY
node scripts/ci/project-block-consistency.mjs; echo "exit=$?"   # MUST be non-zero
git checkout -- .project/handoff.json
node scripts/ci/project-block-consistency.mjs; echo "exit=$?"   # MUST be zero again
```

- [ ] **Step 6: Commit**

```bash
git status --short   # .project/handoff.json MUST NOT appear — the tripwire was reverted
node scripts/no-os-resolution.mjs   # delta: 0
refarm agent finish --lane after-edit --run --json
git add scripts/ci/project-block-consistency.mjs scripts/ci/project-block-consistency.test.mjs package.json .github/workflows/test.yml
git commit -m "feat(gate): the ledger gate gains an external anchor"
refarm agent finish --lane after-commit --run --json
```

---

### Task 7: `refarm resume` answers "what is left"

**Files:**
- Modify: `apps/refarm/src/commands/resume.ts`
- Test: `apps/refarm/test/commands/resume-ledger.test.ts`

**Interfaces:** Consumes `resolveWorkspaceLedger` (Task 4) and `ProjectHandoffTruncation` (Task 1).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildLedgerSummary } from "../../src/commands/resume.js";

describe("buildLedgerSummary", () => {
	it("groups by workspace and never sums across them", () => {
		const summary = buildLedgerSummary({
			refarm: { ok: true, items: [{ id: "ISS-001", status: "open", axis: "cost" }] },
			rcdc5: { ok: true, items: [{ id: "issue-001", status: "open", axis: undefined }] },
		});
		expect(summary.workspaces.refarm.open).toBe(1);
		expect(summary.workspaces.rcdc5.open).toBe(1);
		expect(summary).not.toHaveProperty("total");
	});

	it("reports unclassified as its own row, never folded into an axis", () => {
		const summary = buildLedgerSummary({
			rcdc5: { ok: true, items: [{ id: "a", status: "open" }, { id: "b", status: "open", axis: "cost" }] },
		});
		expect(summary.workspaces.rcdc5.unclassified).toBe(1);
		expect(summary.workspaces.rcdc5.byAxis).toEqual({ cost: 1 });
	});

	it("puts a failed workspace in unreadable, not at zero", () => {
		const summary = buildLedgerSummary({
			broken: { ok: false, error: { reason: "document_unreadable", message: "boom" } },
		});
		expect(summary.workspaces).not.toHaveProperty("broken");
		expect(summary.unreadable.broken.reason).toBe("document_unreadable");
	});

	it("counts only open items", () => {
		const summary = buildLedgerSummary({
			refarm: { ok: true, items: [{ id: "a", status: "resolved" }, { id: "b", status: "open", axis: "cost" }] },
		});
		expect(summary.workspaces.refarm.open).toBe(1);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run test/commands/resume-ledger.test.ts`
Expected: FAIL — `buildLedgerSummary` is not exported.

- [ ] **Step 3: Implement**

Export from `apps/refarm/src/commands/resume.ts`:

```ts
export interface LedgerReadResult {
	ok: boolean;
	items?: { id: string; status: string; axis?: string }[];
	error?: { reason: string; message: string };
}

export interface LedgerSummary {
	workspaces: Record<string, { open: number; unclassified: number; byAxis: Record<string, number> }>;
	unreadable: Record<string, { reason: string; message?: string }>;
}

/** PURE. Takes already-read results so it is testable without a filesystem, and so a slow or
 * failing workspace cannot change the shape of the answer. */
export function buildLedgerSummary(reads: Record<string, LedgerReadResult>): LedgerSummary {
	const workspaces: LedgerSummary["workspaces"] = {};
	const unreadable: LedgerSummary["unreadable"] = {};

	for (const [id, read] of Object.entries(reads)) {
		if (!read.ok) {
			unreadable[id] = read.error ?? { reason: "unknown" };
			continue;   // NEVER `workspaces[id] = { open: 0 }` — unreadable is not empty.
		}
		const open = (read.items ?? []).filter((item) => item.status === "open");
		const byAxis: Record<string, number> = {};
		for (const item of open) {
			if (!item.axis) continue;   // unclassified is its own row, never an axis bucket
			byAxis[item.axis] = (byAxis[item.axis] ?? 0) + 1;
		}
		workspaces[id] = {
			open: open.length,
			unclassified: open.filter((item) => !item.axis).length,
			byAxis,
		};
	}

	return { workspaces, unreadable };
}
```

Note there is no `total` field, and adding one later would be a regression: summing open items across
workspaces is exactly the mixing the operator ruled out.

Wire it into the resume payload as `ledger`, beside the existing `project` block, reading each
declared workspace through `resolveWorkspaceLedger`. Set `nextCommands` to
`refarm issues list --workspace <the workspace with the most open items> --json` when any workspace
has an open item.

- [ ] **Step 4: Run to verify they pass, then prove live**

```bash
pnpm --filter @refarm.dev/refarm exec vitest run test/commands/resume-ledger.test.ts
pnpm --filter @refarm.dev/refarm run build
refarm resume --json | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d['ledger'],indent=1)); print('truncation:', d['project']['truncation'])"
```

Expected: `ledger.workspaces` names refarm and rcdc5 separately with their own counts, `unreadable`
is empty, and `truncation` still reports the totals from Task 1.

- [ ] **Step 5: Full gate and commit**

```bash
node scripts/no-os-resolution.mjs   # delta: 0
pnpm --filter @refarm.dev/refarm run test && pnpm --filter @refarm.dev/refarm run type-check
refarm agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/resume.ts apps/refarm/test/commands/resume-ledger.test.ts
git commit -m "feat(resume): what is left, per workspace, as a number"
refarm agent finish --lane before-push --run --json
```

---

## What is NOT in this plan

- **No `github` or `gitlab` adapter.** The mapping table lives in the spec and is copied into
  `docs/WORK_ITEM_LEDGER.md` marked *designed, not built*. `rejectUnsupportedFields` and the
  `REMOTE_LIKE` capability fixture exist so the seam is exercised without one.
- **No fix to any of the ~29 migrated items.** They become countable here; each gets its own slice.
- **No fix to `refarm project`'s positional resolution of `handoff.json`.** That is one of the items
  Task 5 files, and it belongs to the node-vs-directory axis.
- **No change to `.project/tasks.json`, `.project/requirements.json`, or their schemas.**
- **No new dependency, no Rust, no WASM rebuild, no node restart.**

## Done when

- `refarm resume --json` reports `truncation` with real totals and a `ledger` block grouped by
  workspace.
- `refarm issues list --all-workspaces --json` returns identical output from `/tmp`,
  `~/github/refarm` and `~/git/rcdc5/rcdc5`, with refarm and rcdc5 as separate groups.
- `node scripts/ci/project-block-consistency.mjs` passes, and fails when an uncited entry is added.
- `node scripts/no-os-resolution.mjs` reports **117, delta 0**.
- The ~29 loose ends are addressable, classified, and the two contradictions carry a measured verdict.
