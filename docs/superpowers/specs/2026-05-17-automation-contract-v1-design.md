# automation-contract-v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the Automation artefact domain — a managed artefact with `draft → ready → active → archived` lifecycle that, when triggered, produces an `Effort` for submission to an effort adapter.

**Architecture:** Two new packages: `artefact-contract-v1` (shared lifecycle base types, zero deps) and `automation-contract-v1` (extends `ManagedArtefact`, adds `body`/`triggers`/adapter interface). The automation adapter exposes CRUD + explicit status transition methods + `trigger()` returning a ready-to-submit `Effort`. The caller (farmhand, runtime, CLI) submits the returned Effort to the effort adapter — the two contracts are independent and connected only by the caller.

**Tech Stack:** TypeScript, Vitest, `@refarm.dev/effort-contract-v1` (for `Effort` type), `@refarm.dev/artefact-contract-v1` (for `ManagedArtefact`), pnpm scaffold (`pnpm turbo gen package`).

---

## Domain distinction

```
Automation (artefact)          →    Effort (execution)
draft → ready → active              pending → in-progress → done | partial
       ↓                                      | failed | timed-out | cancelled
    archived
```

An `active` Automation generates `Effort` payloads when triggered. An Effort has no draft — executions start immediately. These are separate domains, separate contracts, separate adapters. Farmhand wires them.

---

## Package 1: `artefact-contract-v1`

**Location:** `packages/artefact-contract-v1`

### Types

```typescript
export const ARTEFACT_CAPABILITY = "artefact:v1" as const;

export type ArtefactStatus = "draft" | "ready" | "active" | "archived";

export const ARTEFACT_TERMINAL_STATES: ReadonlySet<ArtefactStatus> = new Set([
  "archived",
]);

const VALID_TRANSITIONS: ReadonlyMap<ArtefactStatus, ReadonlySet<ArtefactStatus>> = new Map([
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
  revision?: number;    // adapter decides whether to increment on update
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
  archivedAt?: string;  // ISO 8601, set when archived
}
```

No adapter interface, no conformance suite — purely shared vocabulary.

---

## Package 2: `automation-contract-v1`

**Location:** `packages/automation-contract-v1`

**Dependencies:** `@refarm.dev/artefact-contract-v1`, `@refarm.dev/effort-contract-v1`

### Core type

```typescript
import type { ManagedArtefact } from "@refarm.dev/artefact-contract-v1";

export const AUTOMATION_CAPABILITY = "automation:v1" as const;

export interface Automation extends ManagedArtefact {
  name: string;
  description?: string;
  body: AutomationBody;
  triggers: AutomationTrigger[];  // at least one; adapter validates
}
```

### Body (discriminated union)

```typescript
/** Minimal JSON Schema for input validation — semantics are adapter-defined. */
export type JsonSchema = Record<string, unknown>;

/** Effort fields provided by the automation author (runtime fields omitted). */
export type EffortTemplate = Omit<Effort, "id" | "submittedAt">;

/** Fixed Effort template — same shape every run, no interpolation. */
export interface StaticBody {
  type: "static";
  effort: EffortTemplate;
}

/**
 * String-interpolated template — `direction` and string `args` support
 * `{{varName}}` placeholders. Adapter interpolates from trigger `input`.
 */
export interface TemplateBody {
  type: "template";
  effort: EffortTemplate;
  inputSchema?: JsonSchema;
}

/**
 * Delegates Effort construction to a loaded plugin function.
 * Adapter calls `pluginId.fn(input)` which returns an Effort.
 */
export interface PluginBody {
  type: "plugin";
  pluginId: string;
  fn: string;
  inputSchema?: JsonSchema;
}

export type AutomationBody = StaticBody | TemplateBody | PluginBody;
```

### Triggers (discriminated union)

```typescript
export interface ManualTrigger {
  type: "manual";
}

export interface CronTrigger {
  type: "cron";
  schedule: string;    // cron expression, e.g. "0 9 * * 1-5"
  timezone?: string;   // IANA tz, e.g. "America/Sao_Paulo" — default UTC
}

export interface EventTrigger {
  type: "event";
  eventType: string;              // e.g. "effort.completed", "node.created"
  filter?: Record<string, unknown>; // opaque predicate — runtime interprets
}

export type AutomationTrigger = ManualTrigger | CronTrigger | EventTrigger;
```

A single Automation may declare multiple triggers (e.g. manual + cron). The adapter stores all of them; each runtime connects the ones it knows how to drive.

### Adapter interface

```typescript
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
  create(
    automation: Omit<Automation, "id" | "createdAt" | "updatedAt" | "status">,
  ): Promise<Automation>;                     // always starts as "draft"

  get(id: string): Promise<Automation | null>;

  update(
    id: string,
    patch: Partial<Omit<Automation, "id" | "createdAt" | "status">>,
  ): Promise<Automation>;                     // status changes only via transitions

  delete(id: string): Promise<void>;

  query?(filter?: AutomationFilter): Promise<Automation[]>;

  // ── Status transitions ────────────────────────────────────────────────────
  validate(id: string): Promise<Automation>;    // draft   → ready
  activate(id: string): Promise<Automation>;    // ready   → active
  deactivate(id: string): Promise<Automation>;  // active  → ready
  archive(id: string): Promise<Automation>;     // any     → archived
  revert(id: string): Promise<Automation>;      // ready   → draft

  // ── Trigger ──────────────────────────────────────────────────────────────
  /**
   * Returns a ready-to-submit Effort, or null if:
   * - automation not found
   * - automation is not active
   * - plugin body function returns null
   *
   * Does NOT submit to the effort adapter — caller is responsible.
   */
  trigger(id: string, input?: unknown): Promise<Effort | null>;

  // ── Optional ──────────────────────────────────────────────────────────────
  summary?(): Promise<AutomationSummary>;
}
```

### In-memory adapter

```typescript
export interface InMemoryAutomationOptions {
  /** Default body for automations created without an explicit body override. */
  body?: AutomationBody;
  /**
   * For plugin bodies: the function called instead of a real loaded plugin.
   * Receives trigger input, returns an Effort or null.
   */
  pluginFn?: (input: unknown) => Effort | null;
}

export function createInMemoryAutomationAdapter(
  opts?: InMemoryAutomationOptions,
): AutomationAdapter { ... }
```

Default `body` when none provided: `{ type: "static", effort: { direction: "in-memory", tasks: [] } }`.

For `template` bodies, the adapter performs `{{varName}}` substitution in `direction` and any string-valued args fields. For `plugin` bodies, the adapter calls `opts.pluginFn` (throws if not provided).

### Conformance suite — 14 checks

| # | Check |
|---|-------|
| 1 | `create()` returns Automation with status `"draft"` |
| 2 | `get(unknown)` returns `null` |
| 3 | `get(id)` returns Automation with correct shape |
| 4 | `validate(draft-id)` → status `"ready"` |
| 5 | `activate(ready-id)` → status `"active"` |
| 6 | `trigger(active-id)` returns `Effort` (not null) |
| 7 | `trigger(non-active-id)` returns `null` |
| 8 | `trigger(unknown-id)` returns `null` |
| 9 | `deactivate(active-id)` → status `"ready"` |
| 10 | `revert(ready-id)` → status `"draft"` |
| 11 | `archive(id)` → status `"archived"` |
| 12 | `delete(id)` → subsequent `get(id)` returns `null` |
| 13 | `summary?()` — if present, has all numeric fields (`total`, `draft`, `ready`, `active`, `archived`) |
| 14 | `query?()` — if present, result contains the created automation |

---

## File layout

```
packages/artefact-contract-v1/
  src/
    types.ts          — ArtefactStatus, ManagedArtefact, canTransition, ARTEFACT_TERMINAL_STATES
    index.ts          — re-exports
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts

packages/automation-contract-v1/
  src/
    types.ts          — Automation, AutomationBody, AutomationTrigger, AutomationAdapter, ...
    in-memory.ts      — createInMemoryAutomationAdapter
    conformance.ts    — runAutomationV1Conformance
    conformance.test.ts — 3 describe blocks (static, template, plugin bodies)
    index.ts          — re-exports
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
```

---

## Wiring notes (not part of this contract)

- Farmhand will hold an `AutomationAdapter` alongside the existing `EffortTransportAdapter`.
- When a cron trigger fires, farmhand calls `auto.trigger(id)` → submits the returned `Effort`.
- When an event fires, farmhand matches `eventType` against active automations, calls `trigger()` for each match.
- The automation adapter never imports farmhand — dependency flows one way.
