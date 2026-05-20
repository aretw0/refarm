# automation-contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement two new packages — `artefact-contract-v1` (shared lifecycle base types) and `automation-contract-v1` (automation artefact with body/trigger discriminated unions, full adapter interface, in-memory adapter, and 14-check conformance suite).

**Architecture:** `artefact-contract-v1` is a buildable package with pure types and the `canTransition()` guard — no adapter, no conformance suite. `automation-contract-v1` is a contract-v1 package that imports from both `artefact-contract-v1` and `effort-contract-v1`; its adapter interface exposes CRUD + status transition methods + `trigger()` returning an `Effort` ready to submit. The caller (farmhand/runtime) wires the two adapters together.

**Tech Stack:** TypeScript, Vitest, pnpm turbo generator (`pnpm turbo gen package`), `@refarm.dev/artefact-contract-v1`, `@refarm.dev/effort-contract-v1`.

**Spec:** `docs/superpowers/specs/2026-05-17-automation-contract-v1-design.md`

---

## File map

```
packages/artefact-contract-v1/          ← NEW (buildable)
  src/
    types.ts                            ← ArtefactStatus, ManagedArtefact, canTransition, ARTEFACT_TERMINAL_STATES
    index.ts                            ← re-exports
    index.test.ts                       ← unit tests for canTransition
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts

packages/automation-contract-v1/       ← NEW (contract-v1)
  src/
    types.ts                            ← Automation, AutomationBody, AutomationTrigger, AutomationAdapter, etc.
    in-memory.ts                        ← createInMemoryAutomationAdapter
    conformance.ts                      ← runAutomationV1Conformance (14 checks)
    conformance.test.ts                 ← 3 describe blocks (static, template, plugin bodies)
    index.ts                            ← re-exports
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts

scripts/ci/subprocess-utils.mjs        ← MODIFY: add both packages to TASK_SMOKE_TS_BUILD_ORDER
```

---

## Task 1: Scaffold and implement `artefact-contract-v1`

**Files:**
- Create: `packages/artefact-contract-v1/` (via generator)
- Modify: `packages/artefact-contract-v1/src/types.ts` (replace generated stub)
- Modify: `packages/artefact-contract-v1/src/index.ts` (replace generated stub)
- Modify: `packages/artefact-contract-v1/src/index.test.ts` (replace generated stub)
- Modify: `packages/artefact-contract-v1/package.json` (fix test:unit script)
- Modify: `scripts/ci/subprocess-utils.mjs` (add to BUILD_ORDER)

- [ ] **Step 1: Scaffold the package**

Run from repo root:
```bash
pnpm turbo gen package
```

Answer the prompts:
- Package name: `artefact-contract-v1`
- Package type: `buildable`
- Description: `Shared artefact lifecycle types (draft/ready/active/archived) for managed artefacts`
- Private? `No`

The generator creates `packages/artefact-contract-v1/` and patches `tsconfig.json` at root.

- [ ] **Step 2: Verify scaffold output**

```bash
ls packages/artefact-contract-v1/src/
```

Expected: `index.ts  index.test.ts`

- [ ] **Step 3: Write the failing test**

Replace `packages/artefact-contract-v1/src/index.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { canTransition, ARTEFACT_TERMINAL_STATES } from "./types.js";

describe("canTransition", () => {
  it("draft → ready is valid", () => expect(canTransition("draft", "ready")).toBe(true));
  it("draft → archived is valid", () => expect(canTransition("draft", "archived")).toBe(true));
  it("draft → active is invalid", () => expect(canTransition("draft", "active")).toBe(false));
  it("ready → active is valid", () => expect(canTransition("ready", "active")).toBe(true));
  it("ready → draft is valid", () => expect(canTransition("ready", "draft")).toBe(true));
  it("ready → archived is valid", () => expect(canTransition("ready", "archived")).toBe(true));
  it("active → ready is valid", () => expect(canTransition("active", "ready")).toBe(true));
  it("active → archived is valid", () => expect(canTransition("active", "archived")).toBe(true));
  it("active → draft is invalid", () => expect(canTransition("active", "draft")).toBe(false));
  it("archived → anything is invalid", () => {
    expect(canTransition("archived", "draft")).toBe(false);
    expect(canTransition("archived", "ready")).toBe(false);
    expect(canTransition("archived", "active")).toBe(false);
  });
});

describe("ARTEFACT_TERMINAL_STATES", () => {
  it("contains only archived", () => {
    expect(ARTEFACT_TERMINAL_STATES.has("archived")).toBe(true);
    expect(ARTEFACT_TERMINAL_STATES.size).toBe(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm --filter @refarm.dev/artefact-contract-v1 test
```

Expected: FAIL — `Cannot find module './types.js'`

- [ ] **Step 5: Implement `src/types.ts`**

Create `packages/artefact-contract-v1/src/types.ts`:

```typescript
export const ARTEFACT_CAPABILITY = "artefact:v1" as const;

export type ArtefactStatus = "draft" | "ready" | "active" | "archived";

export const ARTEFACT_TERMINAL_STATES: ReadonlySet<ArtefactStatus> = new Set([
	"archived",
]);

const VALID_TRANSITIONS = new Map<ArtefactStatus, ReadonlySet<ArtefactStatus>>([
	["draft",    new Set(["ready", "archived"])],
	["ready",    new Set(["draft", "active", "archived"])],
	["active",   new Set(["ready", "archived"])],
	["archived", new Set()],
]);

export function canTransition(from: ArtefactStatus, to: ArtefactStatus): boolean {
	return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

export interface ManagedArtefact {
	id: string;
	status: ArtefactStatus;
	tags?: string[];
	/** Adapter decides whether to increment on each update. */
	revision?: number;
	createdAt: string;  // ISO 8601
	updatedAt: string;  // ISO 8601
	archivedAt?: string; // ISO 8601, set when transitioning to archived
}
```

- [ ] **Step 6: Update `src/index.ts`**

Replace `packages/artefact-contract-v1/src/index.ts` with:

```typescript
export { ARTEFACT_CAPABILITY, ARTEFACT_TERMINAL_STATES, canTransition } from "./types.js";
export type { ArtefactStatus, ManagedArtefact } from "./types.js";
```

- [ ] **Step 7: Fix `package.json` test:unit script**

In `packages/artefact-contract-v1/package.json`, change:
```json
"test:unit": "vitest run src/index.test.ts",
```
to:
```json
"test:unit": "vitest run",
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm --filter @refarm.dev/artefact-contract-v1 test
```

Expected: PASS — 12 tests passing

- [ ] **Step 9: Build the package**

```bash
pnpm --filter @refarm.dev/artefact-contract-v1 build
```

Expected: exits 0, `packages/artefact-contract-v1/dist/` created with `index.js`, `index.d.ts`

- [ ] **Step 10: Add to TASK_SMOKE_TS_BUILD_ORDER**

In `scripts/ci/subprocess-utils.mjs`, add `"packages/artefact-contract-v1"` after `"packages/effort-contract-v1"`:

```javascript
const TASK_SMOKE_TS_BUILD_ORDER = [
	"packages/root",
	"packages/effort-contract-v1",
	"packages/artefact-contract-v1",   // ← add this line
	"packages/identity-contract-v1",
	// ... rest unchanged
```

- [ ] **Step 11: Commit**

```bash
git add packages/artefact-contract-v1/ scripts/ci/subprocess-utils.mjs tsconfig.json
git commit -m "feat(artefact-contract-v1): shared managed artefact lifecycle types"
```

---

## Task 2: Scaffold and type `automation-contract-v1`

**Files:**
- Create: `packages/automation-contract-v1/` (via generator)
- Modify: `packages/automation-contract-v1/package.json` (add deps, fix scripts)
- Modify: `packages/automation-contract-v1/src/types.ts` (full implementation)
- Modify: `packages/automation-contract-v1/src/index.ts` (re-exports)
- Modify: `scripts/ci/subprocess-utils.mjs` (add to BUILD_ORDER)

- [ ] **Step 1: Scaffold the package**

```bash
pnpm turbo gen package
```

Answer the prompts:
- Package name: `automation-contract-v1`
- Package type: `contract-v1`
- Description: `Versioned automation capability contract (automation:v1) and conformance suite`
- Private? `No`

- [ ] **Step 2: Add runtime dependencies**

In `packages/automation-contract-v1/package.json`, add a `"dependencies"` block (after `"devDependencies"`):

```json
"dependencies": {
  "@refarm.dev/artefact-contract-v1": "workspace:*",
  "@refarm.dev/effort-contract-v1": "workspace:*"
},
```

Full `package.json` after edit:

```json
{
  "name": "@refarm.dev/automation-contract-v1",
  "version": "0.1.0",
  "private": false,
  "description": "Versioned automation capability contract (automation:v1) and conformance suite",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "lint": "eslint src",
    "type-check": "tsc --noEmit",
    "type-check:dist": "tsc --project tsconfig.build.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run src/conformance.test.ts",
    "test:conformance": "vitest run src/conformance.test.ts",
    "clean": "rm -rf dist"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@refarm.dev/artefact-contract-v1": "workspace:*",
    "@refarm.dev/effort-contract-v1": "workspace:*"
  },
  "devDependencies": {
    "@refarm.dev/eslint-config": "workspace:*",
    "@refarm.dev/tsconfig": "workspace:*",
    "@refarm.dev/vtconfig": "workspace:*"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 4: Write `src/types.ts`**

Replace the generated stub at `packages/automation-contract-v1/src/types.ts` with:

```typescript
import type { ManagedArtefact, ArtefactStatus } from "@refarm.dev/artefact-contract-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";

export const AUTOMATION_CAPABILITY = "automation:v1" as const;

// Re-export for consumers who only import from this package
export type { ArtefactStatus };

// ── Body types ────────────────────────────────────────────────────────────────

/** Minimal JSON Schema for input validation. Semantics are adapter-defined. */
export type JsonSchema = Record<string, unknown>;

/** Effort fields provided by the automation author (id and submittedAt are runtime-generated). */
export type EffortTemplate = Omit<Effort, "id" | "submittedAt">;

/** Fixed Effort template — identical shape every run, no interpolation. */
export interface StaticBody {
	type: "static";
	effort: EffortTemplate;
}

/**
 * String-interpolated template — `direction` and string-valued args support
 * `{{varName}}` placeholders. The adapter substitutes from the trigger `input`.
 */
export interface TemplateBody {
	type: "template";
	effort: EffortTemplate;
	inputSchema?: JsonSchema;
}

/**
 * Delegates Effort construction to a loaded plugin function.
 * The adapter calls `pluginId.fn(input)` which returns an Effort or null.
 */
export interface PluginBody {
	type: "plugin";
	pluginId: string;
	fn: string;
	inputSchema?: JsonSchema;
}

export type AutomationBody = StaticBody | TemplateBody | PluginBody;

// ── Trigger types ─────────────────────────────────────────────────────────────

export interface ManualTrigger {
	type: "manual";
}

export interface CronTrigger {
	type: "cron";
	/** Standard cron expression, e.g. "0 9 * * 1-5" */
	schedule: string;
	/** IANA timezone, e.g. "America/Sao_Paulo". Defaults to UTC. */
	timezone?: string;
}

export interface EventTrigger {
	type: "event";
	/** e.g. "effort.completed", "node.created" */
	eventType: string;
	/** Opaque predicate — the runtime interprets the filter language. */
	filter?: Record<string, unknown>;
}

export type AutomationTrigger = ManualTrigger | CronTrigger | EventTrigger;

// ── Core artefact type ────────────────────────────────────────────────────────

export interface Automation extends ManagedArtefact {
	name: string;
	description?: string;
	body: AutomationBody;
	/** At least one trigger must be declared. The adapter stores all; each runtime connects what it supports. */
	triggers: AutomationTrigger[];
}

// ── Adapter surface ───────────────────────────────────────────────────────────

export interface AutomationFilter {
	status?: ArtefactStatus | ArtefactStatus[];
	tags?: string[];
}

export interface AutomationSummary {
	total: number;
	draft: number;
	ready: number;
	active: number;
	archived: number;
}

export interface AutomationConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

export interface AutomationAdapter {
	// ── CRUD ──────────────────────────────────────────────────────────────────
	/** Always creates with status "draft". */
	create(
		automation: Omit<Automation, "id" | "createdAt" | "updatedAt" | "status">,
	): Promise<Automation>;

	get(id: string): Promise<Automation | null>;

	/** Status changes are only allowed via the transition methods below. */
	update(
		id: string,
		patch: Partial<Omit<Automation, "id" | "createdAt" | "status">>,
	): Promise<Automation>;

	delete(id: string): Promise<void>;

	query?(filter?: AutomationFilter): Promise<Automation[]>;

	// ── Status transitions ────────────────────────────────────────────────────
	validate(id: string): Promise<Automation>;    // draft   → ready
	activate(id: string): Promise<Automation>;    // ready   → active
	deactivate(id: string): Promise<Automation>;  // active  → ready
	archive(id: string): Promise<Automation>;     // any     → archived  (terminal)
	revert(id: string): Promise<Automation>;      // ready   → draft

	// ── Trigger ──────────────────────────────────────────────────────────────
	/**
	 * Returns a ready-to-submit Effort, or null when:
	 * - automation not found
	 * - automation is not active
	 * - plugin body function returns null
	 *
	 * Does NOT submit to an effort adapter — the caller is responsible.
	 */
	trigger(id: string, input?: unknown): Promise<Effort | null>;

	// ── Optional ──────────────────────────────────────────────────────────────
	summary?(): Promise<AutomationSummary>;
}
```

- [ ] **Step 5: Update `src/index.ts`**

Replace the generated `packages/automation-contract-v1/src/index.ts` with:

```typescript
export { AUTOMATION_CAPABILITY } from "./types.js";
export type {
	ArtefactStatus,
	Automation,
	AutomationAdapter,
	AutomationBody,
	AutomationConformanceResult,
	AutomationFilter,
	AutomationSummary,
	AutomationTrigger,
	CronTrigger,
	EffortTemplate,
	EventTrigger,
	JsonSchema,
	ManualTrigger,
	PluginBody,
	StaticBody,
	TemplateBody,
} from "./types.js";
export { createInMemoryAutomationAdapter } from "./in-memory.js";
export type { InMemoryAutomationOptions } from "./in-memory.js";
export { runAutomationV1Conformance } from "./conformance.js";
```

- [ ] **Step 6: Verify type-check passes**

```bash
pnpm --filter @refarm.dev/automation-contract-v1 type-check
```

Expected: exits 0 (the generated stubs in in-memory.ts and conformance.ts will cause errors — that's fine, we replace them in Task 3)

If type-check errors reference generated stubs, replace `src/in-memory.ts` temporarily with:
```typescript
export interface InMemoryAutomationOptions {}
export function createInMemoryAutomationAdapter(_opts?: InMemoryAutomationOptions): never {
  throw new Error("not implemented");
}
```

And `src/conformance.ts` temporarily with:
```typescript
import type { AutomationAdapter, AutomationConformanceResult } from "./types.js";
export async function runAutomationV1Conformance(_adapter: AutomationAdapter): Promise<AutomationConformanceResult> {
  throw new Error("not implemented");
}
```

- [ ] **Step 7: Add to TASK_SMOKE_TS_BUILD_ORDER**

In `scripts/ci/subprocess-utils.mjs`, add `"packages/automation-contract-v1"` after `"packages/artefact-contract-v1"`:

```javascript
	"packages/artefact-contract-v1",
	"packages/automation-contract-v1",  // ← add this line
	"packages/identity-contract-v1",
```

- [ ] **Step 8: Build the package**

```bash
pnpm --filter @refarm.dev/artefact-contract-v1 build
pnpm --filter @refarm.dev/automation-contract-v1 build
```

Expected: both exit 0

- [ ] **Step 9: Commit**

```bash
git add packages/automation-contract-v1/ scripts/ci/subprocess-utils.mjs
git commit -m "feat(automation-contract-v1): scaffold + types + adapter interface"
```

---

## Task 3: In-memory adapter + conformance suite (TDD)

**Files:**
- Modify: `packages/automation-contract-v1/src/conformance.test.ts`
- Modify: `packages/automation-contract-v1/src/conformance.ts`
- Modify: `packages/automation-contract-v1/src/in-memory.ts`

- [ ] **Step 1: Write the failing conformance test**

Replace `packages/automation-contract-v1/src/conformance.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { runAutomationV1Conformance } from "./conformance.js";
import { createInMemoryAutomationAdapter } from "./in-memory.js";

const STATIC_BODY = {
	type: "static" as const,
	effort: { direction: "test direction", tasks: [] },
};

const TEMPLATE_BODY = {
	type: "template" as const,
	effort: { direction: "hello {{name}}", tasks: [] },
	inputSchema: { type: "object", properties: { name: { type: "string" } } },
};

const PLUGIN_BODY = {
	type: "plugin" as const,
	pluginId: "test-plugin",
	fn: "buildEffort",
};

describe("AutomationAdapter conformance — in-memory (static body)", () => {
	it("passes all checks", async () => {
		const adapter = createInMemoryAutomationAdapter({ body: STATIC_BODY });
		const result = await runAutomationV1Conformance(adapter);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("AutomationAdapter conformance — in-memory (template body)", () => {
	it("passes all checks", async () => {
		const adapter = createInMemoryAutomationAdapter({ body: TEMPLATE_BODY });
		const result = await runAutomationV1Conformance(adapter);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("AutomationAdapter conformance — in-memory (plugin body)", () => {
	it("passes all checks", async () => {
		const adapter = createInMemoryAutomationAdapter({
			body: PLUGIN_BODY,
			pluginFn: (_input) => ({
				id: crypto.randomUUID(),
				direction: "plugin-generated",
				tasks: [],
				submittedAt: new Date().toISOString(),
			}),
		});
		const result = await runAutomationV1Conformance(adapter);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("createInMemoryAutomationAdapter — status transitions", () => {
	it("create() always starts as draft", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		expect(a.status).toBe("draft");
	});

	it("full lifecycle: draft → ready → active → ready → draft → archived", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		expect((await adapter.validate(a.id)).status).toBe("ready");
		expect((await adapter.activate(a.id)).status).toBe("active");
		expect((await adapter.deactivate(a.id)).status).toBe("ready");
		expect((await adapter.revert(a.id)).status).toBe("draft");
		expect((await adapter.archive(a.id)).status).toBe("archived");
	});

	it("invalid transitions throw", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		// draft → active is invalid (must go through ready first)
		await expect(adapter.activate(a.id)).rejects.toThrow();
	});
});

describe("createInMemoryAutomationAdapter — trigger", () => {
	it("trigger(active) returns Effort with direction from static body", async () => {
		const adapter = createInMemoryAutomationAdapter({ body: STATIC_BODY });
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		await adapter.validate(a.id);
		await adapter.activate(a.id);
		const effort = await adapter.trigger(a.id);
		expect(effort).not.toBeNull();
		expect(effort!.direction).toBe("test direction");
	});

	it("trigger(active) interpolates template body", async () => {
		const adapter = createInMemoryAutomationAdapter({ body: TEMPLATE_BODY });
		const a = await adapter.create({ name: "test", body: TEMPLATE_BODY, triggers: [{ type: "manual" }] });
		await adapter.validate(a.id);
		await adapter.activate(a.id);
		const effort = await adapter.trigger(a.id, { name: "World" });
		expect(effort!.direction).toBe("hello World");
	});

	it("trigger(draft) returns null", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "test", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		const effort = await adapter.trigger(a.id);
		expect(effort).toBeNull();
	});

	it("trigger(unknown) returns null", async () => {
		const adapter = createInMemoryAutomationAdapter();
		expect(await adapter.trigger("__nonexistent__")).toBeNull();
	});
});

describe("createInMemoryAutomationAdapter — summary + query", () => {
	it("summary counts correctly", async () => {
		const adapter = createInMemoryAutomationAdapter();
		await adapter.create({ name: "a", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		const s = await adapter.summary!();
		expect(s.total).toBe(1);
		expect(s.draft).toBe(1);
		expect(s.ready).toBe(0);
		expect(s.active).toBe(0);
		expect(s.archived).toBe(0);
	});

	it("query filters by status", async () => {
		const adapter = createInMemoryAutomationAdapter();
		const a = await adapter.create({ name: "a", body: STATIC_BODY, triggers: [{ type: "manual" }] });
		await adapter.validate(a.id);
		const ready = await adapter.query!({ status: "ready" });
		expect(ready.some((x) => x.id === a.id)).toBe(true);
		const active = await adapter.query!({ status: "active" });
		expect(active.some((x) => x.id === a.id)).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @refarm.dev/automation-contract-v1 test
```

Expected: FAIL — stubs throw "not implemented"

- [ ] **Step 3: Implement `src/in-memory.ts`**

Replace `packages/automation-contract-v1/src/in-memory.ts` with:

```typescript
import { canTransition } from "@refarm.dev/artefact-contract-v1";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type {
	Automation,
	AutomationAdapter,
	AutomationBody,
	AutomationFilter,
	AutomationSummary,
	ArtefactStatus,
	EffortTemplate,
} from "./types.js";

export interface InMemoryAutomationOptions {
	/** Default body used when no body is specified on create(). */
	body?: AutomationBody;
	/** Required when using a plugin body — called instead of loading a real plugin. */
	pluginFn?: (input: unknown) => Effort | null;
}

function nowIso(): string {
	return new Date().toISOString();
}

/** Replace {{varName}} placeholders in a string with values from input. */
function interpolate(template: string, input: Record<string, unknown>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
		String(input[key] ?? ""),
	);
}

function bakeEffort(template: EffortTemplate, input: unknown): Effort {
	const inp =
		input !== null && typeof input === "object"
			? (input as Record<string, unknown>)
			: {};
	return {
		id: crypto.randomUUID(),
		submittedAt: nowIso(),
		direction: interpolate(template.direction, inp),
		tasks: template.tasks,
		source: template.source,
		context: template.context,
		priority: template.priority,
		tags: template.tags,
	};
}

export function createInMemoryAutomationAdapter(
	opts: InMemoryAutomationOptions = {},
): AutomationAdapter {
	const store = new Map<string, Automation>();

	const defaultBody: AutomationBody = opts.body ?? {
		type: "static",
		effort: { direction: "in-memory", tasks: [] },
	};

	function transition(id: string, to: ArtefactStatus): Automation {
		const current = store.get(id);
		if (!current) throw new Error(`Automation not found: ${id}`);
		if (!canTransition(current.status, to)) {
			throw new Error(`Invalid transition: ${current.status} → ${to}`);
		}
		const updated: Automation = {
			...current,
			status: to,
			updatedAt: nowIso(),
			...(to === "archived" ? { archivedAt: nowIso() } : {}),
			...(current.revision !== undefined
				? { revision: current.revision + 1 }
				: {}),
		};
		store.set(id, updated);
		return updated;
	}

	return {
		async create(input) {
			const now = nowIso();
			const automation: Automation = {
				id: crypto.randomUUID(),
				status: "draft",
				createdAt: now,
				updatedAt: now,
				body: defaultBody,
				...input,
			};
			store.set(automation.id, automation);
			return automation;
		},

		async get(id) {
			return store.get(id) ?? null;
		},

		async update(id, patch) {
			const current = store.get(id);
			if (!current) throw new Error(`Automation not found: ${id}`);
			const updated: Automation = { ...current, ...patch, updatedAt: nowIso() };
			store.set(id, updated);
			return updated;
		},

		async delete(id) {
			store.delete(id);
		},

		async query(filter) {
			let results = [...store.values()];
			if (filter?.status !== undefined) {
				const statuses = Array.isArray(filter.status)
					? filter.status
					: [filter.status];
				results = results.filter((a) => statuses.includes(a.status));
			}
			if (filter?.tags?.length) {
				results = results.filter((a) =>
					filter.tags!.every((t) => a.tags?.includes(t)),
				);
			}
			return results;
		},

		async validate(id) { return transition(id, "ready"); },
		async activate(id) { return transition(id, "active"); },
		async deactivate(id) { return transition(id, "ready"); },
		async archive(id) { return transition(id, "archived"); },
		async revert(id) { return transition(id, "draft"); },

		async trigger(id, input) {
			const automation = store.get(id);
			if (!automation || automation.status !== "active") return null;

			const { body } = automation;

			if (body.type === "static") {
				return bakeEffort(body.effort, input);
			}

			if (body.type === "template") {
				return bakeEffort(body.effort, input);
			}

			if (body.type === "plugin") {
				if (!opts.pluginFn) {
					throw new Error(
						"pluginFn is required in InMemoryAutomationOptions when using plugin body type",
					);
				}
				return opts.pluginFn(input);
			}

			return null;
		},

		async summary() {
			const all = [...store.values()];
			const s: AutomationSummary = {
				total: all.length,
				draft: 0,
				ready: 0,
				active: 0,
				archived: 0,
			};
			for (const a of all) s[a.status] += 1;
			return s;
		},
	};
}
```

- [ ] **Step 4: Implement `src/conformance.ts`**

Replace `packages/automation-contract-v1/src/conformance.ts` with:

```typescript
import type { AutomationAdapter, AutomationConformanceResult } from "./types.js";

function makeInput() {
	return {
		name: `conformance-${Date.now()}`,
		body: {
			type: "static" as const,
			effort: { direction: "conformance test effort", tasks: [] },
		},
		triggers: [{ type: "manual" as const }],
	};
}

export async function runAutomationV1Conformance(
	adapter: AutomationAdapter,
): Promise<AutomationConformanceResult> {
	const failures: string[] = [];

	function check(label: string, condition: boolean): void {
		if (!condition) failures.push(label);
	}

	// 1. create() returns Automation with status "draft"
	let automation;
	try {
		automation = await adapter.create(makeInput());
		check(
			"create() returns Automation with status draft",
			automation.status === "draft" &&
				typeof automation.id === "string" &&
				automation.id.length > 0,
		);
	} catch (e) {
		failures.push(`create() threw: ${String(e)}`);
		return { pass: false, total: 14, failed: failures.length, failures };
	}

	// 2. get(unknown) returns null
	try {
		check("get(unknown) returns null", (await adapter.get("__nonexistent__")) === null);
	} catch (e) {
		failures.push(`get(unknown) threw: ${String(e)}`);
	}

	// 3. get(id) returns Automation with correct shape
	try {
		const result = await adapter.get(automation.id);
		check(
			"get(id) returns Automation with correct shape",
			result !== null &&
				typeof result.name === "string" &&
				result.body !== undefined &&
				Array.isArray(result.triggers),
		);
	} catch (e) {
		failures.push(`get(id) threw: ${String(e)}`);
	}

	// 4. validate(draft-id) → ready
	try {
		const result = await adapter.validate(automation.id);
		check("validate() transitions to ready", result.status === "ready");
	} catch (e) {
		failures.push(`validate() threw: ${String(e)}`);
	}

	// 5. activate(ready-id) → active
	try {
		const result = await adapter.activate(automation.id);
		check("activate() transitions to active", result.status === "active");
	} catch (e) {
		failures.push(`activate() threw: ${String(e)}`);
	}

	// 6. trigger(active-id) returns Effort (not null)
	try {
		const effort = await adapter.trigger(automation.id);
		check(
			"trigger(active-id) returns Effort",
			effort !== null &&
				typeof effort.id === "string" &&
				typeof effort.direction === "string",
		);
	} catch (e) {
		failures.push(`trigger(active-id) threw: ${String(e)}`);
	}

	// 7. trigger(non-active-id) returns null
	try {
		const draft = await adapter.create(makeInput());
		check("trigger(non-active-id) returns null", (await adapter.trigger(draft.id)) === null);
	} catch (e) {
		failures.push(`trigger(non-active-id) threw: ${String(e)}`);
	}

	// 8. trigger(unknown-id) returns null
	try {
		check("trigger(unknown-id) returns null", (await adapter.trigger("__nonexistent__")) === null);
	} catch (e) {
		failures.push(`trigger(unknown-id) threw: ${String(e)}`);
	}

	// 9. deactivate(active-id) → ready
	try {
		const result = await adapter.deactivate(automation.id);
		check("deactivate() transitions to ready", result.status === "ready");
	} catch (e) {
		failures.push(`deactivate() threw: ${String(e)}`);
	}

	// 10. revert(ready-id) → draft
	try {
		const result = await adapter.revert(automation.id);
		check("revert() transitions to draft", result.status === "draft");
	} catch (e) {
		failures.push(`revert() threw: ${String(e)}`);
	}

	// 11. archive(id) → archived + archivedAt set
	try {
		const result = await adapter.archive(automation.id);
		check(
			"archive() transitions to archived",
			result.status === "archived" && typeof result.archivedAt === "string",
		);
	} catch (e) {
		failures.push(`archive() threw: ${String(e)}`);
	}

	// 12. delete(id) → get(id) returns null
	try {
		const toDelete = await adapter.create(makeInput());
		await adapter.delete(toDelete.id);
		check("delete() removes automation", (await adapter.get(toDelete.id)) === null);
	} catch (e) {
		failures.push(`delete() threw: ${String(e)}`);
	}

	// 13. summary?() — all numeric fields present
	if (adapter.summary) {
		try {
			const s = await adapter.summary();
			check(
				"summary() has all numeric status fields",
				typeof s.total === "number" &&
					typeof s.draft === "number" &&
					typeof s.ready === "number" &&
					typeof s.active === "number" &&
					typeof s.archived === "number" &&
					s.total >= 1,
			);
		} catch (e) {
			failures.push(`summary() threw: ${String(e)}`);
		}
	}

	// 14. query?() — contains the created automation (now archived)
	if (adapter.query) {
		try {
			const queryTarget = await adapter.create(makeInput());
			const all = await adapter.query();
			check(
				"query() contains created automation",
				all.some((a) => a.id === queryTarget.id),
			);
		} catch (e) {
			failures.push(`query() threw: ${String(e)}`);
		}
	}

	const failed = failures.length;
	return { pass: failed === 0, total: 14, failed, failures };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @refarm.dev/automation-contract-v1 test
```

Expected: all tests pass (3 conformance describe blocks + unit tests for transitions, trigger, summary, query)

- [ ] **Step 6: Build both packages**

```bash
pnpm --filter @refarm.dev/artefact-contract-v1 build
pnpm --filter @refarm.dev/automation-contract-v1 build
```

Expected: both exit 0

- [ ] **Step 7: Run validate-packages to confirm no violations**

```bash
node scripts/validate-packages.mjs 2>&1 | grep -E "artefact|automation|PASS|FAIL"
```

Expected: no violations for either package

- [ ] **Step 8: Commit**

```bash
git add packages/automation-contract-v1/src/
git commit -m "feat(automation-contract-v1): in-memory adapter + 14-check conformance suite"
```
