# Daily-Driver Base State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first zero-extension Refarm daily-driver base surface: `refarm status --base` returns a normalized operator state model from runtime, model, and health signals before T1/T2/T3 consume the same base.

**Architecture:** Add a pure base-state model in `apps/refarm/src/commands/base-surface-model.ts`, then a small resolver in `base-surface-status.ts` that adapts existing runtime/model/health payloads into that model. Wire it into `refarm status --base` without replacing existing `status`, `resume`, or `check` behavior.

**Tech Stack:** TypeScript, Commander, Vitest, existing Refarm command payload builders, existing `refarm` operator handoff conventions.

---

## Scope Boundary

This plan implements the first slice of `docs/superpowers/specs/2026-07-07-daily-driver-base-before-examples-design.md`:

- base inventory through code-level normalized units;
- runtime/model/health base state;
- CLI/JSON entrypoint for manual daily-driver exploration;
- documentation of the manual walkthrough.

This plan does not implement TUI/Web rendering, apps/dev/apps/me promotion, or T1/T2/T3 migration. Those should consume the normalized base model after this slice lands.

## File Structure

- Create: `apps/refarm/src/commands/base-surface-model.ts`
  - Pure types and functions for the normalized base surface model.
  - No filesystem, process, Commander, or runtime probing.
- Create: `apps/refarm/test/commands/base-surface-model.test.ts`
  - Unit tests for state normalization, action ordering, and human formatting.
- Create: `apps/refarm/src/commands/base-surface-status.ts`
  - Runtime/model/health resolver that calls existing command builders and returns the pure base model.
- Create: `apps/refarm/test/commands/base-surface-status.test.ts`
  - Unit tests with injected resolver dependencies.
- Modify: `apps/refarm/src/commands/runtime.ts`
  - Export the existing default runtime deps factory so `base-surface-status.ts` can reuse it.
- Modify: `apps/refarm/src/commands/status.ts`
  - Add `createStatusCommand`, `--base`, and `--base --json`.
- Modify: `apps/refarm/test/commands/status.test.ts`
  - Add help and command behavior tests for `status --base`.
- Modify: `docs/REFARM_OPERATOR_DAILY_DRIVER.md`
  - Add the manual daily-driver base walkthrough.

---

### Task 1: Add The Pure Base Surface Model

**Files:**
- Create: `apps/refarm/src/commands/base-surface-model.ts`
- Test: `apps/refarm/test/commands/base-surface-model.test.ts`

- [ ] **Step 1: Write the failing model tests**

Create `apps/refarm/test/commands/base-surface-model.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

import {
	buildBaseSurfaceModel,
	formatBaseSurfaceModel,
} from "../../src/commands/base-surface-model.js";

describe("base surface model", () => {
	it("marks runtime not-ready as the first blocking base unit", () => {
		const model = buildBaseSurfaceModel({
			runtime: {
				command: "runtime",
				operation: "status",
				ok: false,
				configuredEngine: "auto",
				activeEngine: "rust",
				ready: false,
				sidecarUrl: "http://127.0.0.1:42001",
				sidecarProbe: {
					url: "http://127.0.0.1:42001/efforts/summary",
					ready: false,
					error: "connect ECONNREFUSED 127.0.0.1:42001",
				},
				nextAction: "refarm runtime ensure --wait --next-command",
				nextActions: ["refarm runtime ensure --wait --next-command"],
				nextCommand: "refarm runtime ensure --wait --next-command",
				nextCommands: [
					"refarm runtime ensure --wait --next-command",
					"refarm doctor --next-command",
				],
			},
			model: {
				command: "model",
				operation: "current",
				ok: true,
				current: {
					ref: "openai-codex/gpt-5.3-codex-spark",
					provider: "openai-codex",
					modelId: "gpt-5.3-codex-spark",
				},
				credential: {
					state: "silo-oauth",
					status: "Silo OAuth (openai-codex)",
					envKey: "OPENAI_CODEX_ACCESS_TOKEN",
				},
				routes: {},
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			},
			health: {
				command: "health",
				operation: "audit",
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			},
		});

		expect(model.ok).toBe(false);
		expect(model.nextCommand).toBe("refarm runtime ensure --wait --next-command");
		expect(model.units.map((unit) => unit.id)).toEqual([
			"runtime",
			"model",
			"health",
		]);
		expect(model.units[0]).toMatchObject({
			id: "runtime",
			state: "blocked",
			severity: "failure",
			summary: "Runtime sidecar is not ready.",
		});
		expect(model.units[0]?.evidence).toContainEqual({
			kind: "probe",
			label: "sidecar probe",
			value: "connect ECONNREFUSED 127.0.0.1:42001",
		});
		expect(model.units[1]).toMatchObject({
			id: "model",
			state: "ready",
			severity: "info",
			summary: "Model route is configured.",
		});
	});

	it("keeps health policy failures actionable without inventing example-specific wording", () => {
		const model = buildBaseSurfaceModel({
			health: {
				command: "health",
				operation: "audit",
				ok: false,
				issueCount: 1,
				recommendations: [
					{
						diagnostic: "git_ignored",
						issueType: "git_ignored",
						target: "packages/quality-checker-plugin/pkg-plugin/quality_plugin.js",
						summary:
							"packages/quality-checker-plugin/pkg-plugin/quality_plugin.js is ignored by Git.",
						action:
							"Track the source file, or add an explicit health policy exclusion if it is generated.",
						command: "refarm health suggest-policy --json",
					},
				],
				nextAction:
					"Track the source file, or add an explicit health policy exclusion if it is generated.",
				nextActions: [
					"Track the source file, or add an explicit health policy exclusion if it is generated.",
				],
				nextCommand: "refarm health suggest-policy --json",
				nextCommands: ["refarm health suggest-policy --json"],
			},
		});

		expect(model.ok).toBe(false);
		expect(model.nextActions).toEqual([
			"Track the source file, or add an explicit health policy exclusion if it is generated.",
		]);
		expect(model.nextCommands).toEqual(["refarm health suggest-policy --json"]);
		expect(model.units[0]).toMatchObject({
			id: "health",
			state: "blocked",
			severity: "failure",
			summary: "Workspace health has 1 blocking issue.",
		});
	});

	it("formats a compact human summary for manual exploration", () => {
		const model = buildBaseSurfaceModel({
			runtime: {
				command: "runtime",
				operation: "status",
				ok: true,
				configuredEngine: "auto",
				activeEngine: "rust",
				ready: true,
				sidecarUrl: "http://127.0.0.1:42001",
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			},
			health: {
				command: "health",
				operation: "audit",
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			},
		});

		expect(formatBaseSurfaceModel(model)).toContain("Refarm base: ready");
		expect(formatBaseSurfaceModel(model)).toContain("runtime  ready");
		expect(formatBaseSurfaceModel(model)).toContain("health   ready");
	});
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm -C apps/refarm run test:file -- test/commands/base-surface-model.test.ts
```

Expected: FAIL because `../../src/commands/base-surface-model.js` does not exist.

- [ ] **Step 3: Implement the pure model**

Create `apps/refarm/src/commands/base-surface-model.ts` with:

```ts
import chalk from "chalk";

export type BaseSurfaceState =
	| "ready"
	| "degraded"
	| "blocked"
	| "unavailable"
	| "unknown";

export type BaseSurfaceSeverity = "info" | "warning" | "failure";

export interface BaseSurfaceEvidence {
	kind: "command" | "count" | "path" | "probe" | "route" | "state";
	label: string;
	value: string;
}

export interface BaseSurfaceAction {
	label: string;
	command: string;
	primary?: boolean;
}

export interface BaseSurfaceUnit {
	id: "runtime" | "model" | "health";
	label: string;
	owner: "apps/refarm";
	state: BaseSurfaceState;
	severity: BaseSurfaceSeverity;
	summary: string;
	evidence: BaseSurfaceEvidence[];
	actions: BaseSurfaceAction[];
	details?: Record<string, unknown>;
}

interface CommandHandoffLike {
	ok?: boolean;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
	recommendations?: RecommendationLike[];
}

interface RecommendationLike {
	summary?: string;
	action?: string;
	command?: string;
	severity?: BaseSurfaceSeverity;
	target?: string;
	diagnostic?: string;
	issueType?: string;
}

interface RuntimeLike extends CommandHandoffLike {
	command?: "runtime";
	operation?: string;
	configuredEngine?: string;
	activeEngine?: string;
	ready?: boolean;
	sidecarUrl?: string;
	sidecarProbe?: {
		url?: string;
		ready?: boolean;
		status?: number;
		error?: string;
		timedOut?: boolean;
	};
	startCommand?: string;
	issue?: string;
}

interface ModelLike extends CommandHandoffLike {
	command?: "model";
	operation?: string;
	current?: {
		ref?: string;
		provider?: string;
		modelId?: string;
	};
	credential?: {
		state?: string;
		status?: string;
		envKey?: string;
	};
	routes?: Record<string, unknown>;
	source?: unknown;
}

interface HealthLike extends CommandHandoffLike {
	command?: "health";
	operation?: string;
	issueCount?: number;
}

export interface BaseSurfaceModelInput {
	runtime?: RuntimeLike;
	model?: ModelLike;
	health?: HealthLike;
}

export interface BaseSurfaceModel {
	schemaVersion: 1;
	command: "status";
	operation: "base";
	ok: boolean;
	units: BaseSurfaceUnit[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export function buildBaseSurfaceModel(
	input: BaseSurfaceModelInput,
): BaseSurfaceModel {
	const units = [
		input.runtime ? runtimeUnit(input.runtime) : undefined,
		input.model ? modelUnit(input.model) : undefined,
		input.health ? healthUnit(input.health) : undefined,
	].filter((unit): unit is BaseSurfaceUnit => unit !== undefined);
	const nextActions = dedupe([
		...(input.runtime?.nextActions ?? []),
		...(input.model?.nextActions ?? []),
		...(input.health?.nextActions ?? []),
	]);
	const nextCommands = dedupe([
		...(input.runtime?.nextCommands ?? []),
		...(input.model?.nextCommands ?? []),
		...(input.health?.nextCommands ?? []),
	]);

	return {
		schemaVersion: 1,
		command: "status",
		operation: "base",
		ok: units.every((unit) => unit.severity !== "failure"),
		units,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

function runtimeUnit(runtime: RuntimeLike): BaseSurfaceUnit {
	const ready = runtime.ready === true;
	const blocked = runtime.ready === false || runtime.ok === false || Boolean(runtime.issue);
	const evidence: BaseSurfaceEvidence[] = [];
	if (runtime.activeEngine) {
		evidence.push({ kind: "state", label: "engine", value: runtime.activeEngine });
	}
	if (runtime.sidecarUrl) {
		evidence.push({ kind: "route", label: "sidecar", value: runtime.sidecarUrl });
	}
	if (runtime.sidecarProbe?.error) {
		evidence.push({
			kind: "probe",
			label: "sidecar probe",
			value: runtime.sidecarProbe.error,
		});
	} else if (runtime.sidecarProbe?.status !== undefined) {
		evidence.push({
			kind: "probe",
			label: "sidecar probe",
			value: String(runtime.sidecarProbe.status),
		});
	}
	if (runtime.startCommand) {
		evidence.push({
			kind: "command",
			label: "start command",
			value: runtime.startCommand,
		});
	}

	return {
		id: "runtime",
		label: "Runtime",
		owner: "apps/refarm",
		state: ready ? "ready" : blocked ? "blocked" : "unknown",
		severity: blocked ? "failure" : "info",
		summary: ready
			? "Runtime sidecar is ready."
			: blocked
				? "Runtime sidecar is not ready."
				: "Runtime readiness is unknown.",
		evidence,
		actions: actionsFromHandoff(runtime),
		details: {
			configuredEngine: runtime.configuredEngine,
			activeEngine: runtime.activeEngine,
			ready: runtime.ready,
			sidecarProbe: runtime.sidecarProbe,
		},
	};
}

function modelUnit(model: ModelLike): BaseSurfaceUnit {
	const missingCredential = model.credential?.state === "missing";
	const ref = model.current?.ref ?? "unknown";
	return {
		id: "model",
		label: "Model",
		owner: "apps/refarm",
		state: missingCredential ? "blocked" : "ready",
		severity: missingCredential ? "failure" : "info",
		summary: missingCredential
			? "Model route is missing credentials."
			: "Model route is configured.",
		evidence: [
			{ kind: "route", label: "current", value: ref },
			...(model.credential?.status
				? [
						{
							kind: "state" as const,
							label: "credential",
							value: model.credential.status,
						},
					]
				: []),
		],
		actions: actionsFromHandoff(model),
		details: {
			current: model.current,
			credential: model.credential,
			routes: model.routes,
			source: model.source,
		},
	};
}

function healthUnit(health: HealthLike): BaseSurfaceUnit {
	const issueCount = health.issueCount ?? 0;
	const blocked = health.ok === false || issueCount > 0;
	return {
		id: "health",
		label: "Health",
		owner: "apps/refarm",
		state: blocked ? "blocked" : "ready",
		severity: blocked ? "failure" : "info",
		summary: blocked
			? `Workspace health has ${issueCount} blocking issue${issueCount === 1 ? "" : "s"}.`
			: "Workspace health has no blocking issues.",
		evidence: [
			{ kind: "count", label: "issues", value: String(issueCount) },
			...firstRecommendationEvidence(health.recommendations ?? []),
		],
		actions: actionsFromHandoff(health),
		details: {
			issueCount,
			recommendations: health.recommendations ?? [],
		},
	};
}

function firstRecommendationEvidence(
	recommendations: RecommendationLike[],
): BaseSurfaceEvidence[] {
	const first = recommendations[0];
	if (!first) return [];
	return [
		...(first.summary
			? [{ kind: "state" as const, label: "recommendation", value: first.summary }]
			: []),
		...(first.target
			? [{ kind: "path" as const, label: "target", value: first.target }]
			: []),
	];
}

function actionsFromHandoff(handoff: CommandHandoffLike): BaseSurfaceAction[] {
	const commands = dedupe(handoff.nextCommands ?? []);
	const actions = dedupe(handoff.nextActions ?? []);
	return commands.map((command, index) => ({
		label: actions[index] ?? command,
		command,
		...(index === 0 ? { primary: true } : {}),
	}));
}

function dedupe(values: string[]): string[] {
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || result.includes(trimmed)) continue;
		result.push(trimmed);
	}
	return result;
}

export function formatBaseSurfaceModel(model: BaseSurfaceModel): string {
	const lines: string[] = [];
	lines.push(chalk.bold(`Refarm base: ${model.ok ? "ready" : "blocked"}`));
	for (const unit of model.units) {
		const label = unit.id.padEnd(8);
		const state = unit.state.padEnd(9);
		lines.push(`${label} ${state} ${unit.summary}`);
		for (const evidence of unit.evidence.slice(0, 3)) {
			lines.push(chalk.dim(`  ${evidence.label}: ${evidence.value}`));
		}
		if (unit.actions[0]) {
			lines.push(chalk.dim(`  next: ${unit.actions[0].command}`));
		}
	}
	if (model.nextCommand) {
		lines.push("");
		lines.push(chalk.dim(`Next command: ${model.nextCommand}`));
	}
	return lines.join("\n");
}
```

- [ ] **Step 4: Run the model tests and verify they pass**

Run:

```bash
pnpm -C apps/refarm run test:file -- test/commands/base-surface-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the pure model**

```bash
git add apps/refarm/src/commands/base-surface-model.ts apps/refarm/test/commands/base-surface-model.test.ts
git commit -m "feat(refarm): add daily-driver base model"
```

---

### Task 2: Resolve Base State From Existing Runtime, Model, And Health Builders

**Files:**
- Create: `apps/refarm/src/commands/base-surface-status.ts`
- Test: `apps/refarm/test/commands/base-surface-status.test.ts`
- Modify: `apps/refarm/src/commands/runtime.ts`

- [ ] **Step 1: Write the failing resolver tests**

Create `apps/refarm/test/commands/base-surface-status.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import { resolveBaseSurfaceStatus } from "../../src/commands/base-surface-status.js";

describe("resolveBaseSurfaceStatus", () => {
	it("adapts runtime, model, and health payloads into the base model", async () => {
		const model = await resolveBaseSurfaceStatus({
			resolveRuntime: vi.fn().mockResolvedValue({
				command: "runtime",
				operation: "status",
				ok: false,
				configuredEngine: "auto",
				activeEngine: "rust",
				ready: false,
				sidecarUrl: "http://127.0.0.1:42001",
				sidecarProbe: {
					url: "http://127.0.0.1:42001/efforts/summary",
					ready: false,
					error: "connect ECONNREFUSED 127.0.0.1:42001",
				},
				nextAction: "refarm runtime ensure --wait --next-command",
				nextActions: ["refarm runtime ensure --wait --next-command"],
				nextCommand: "refarm runtime ensure --wait --next-command",
				nextCommands: ["refarm runtime ensure --wait --next-command"],
			}),
			resolveModel: vi.fn().mockResolvedValue({
				command: "model",
				operation: "current",
				ok: true,
				current: {
					ref: "openai-codex/gpt-5.3-codex-spark",
					provider: "openai-codex",
					modelId: "gpt-5.3-codex-spark",
				},
				credential: {
					state: "silo-oauth",
					status: "Silo OAuth (openai-codex)",
					envKey: "OPENAI_CODEX_ACCESS_TOKEN",
				},
				routes: {},
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
			resolveHealth: vi.fn().mockResolvedValue({
				command: "health",
				operation: "audit",
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
		});

		expect(model.ok).toBe(false);
		expect(model.units.map((unit) => unit.id)).toEqual([
			"runtime",
			"model",
			"health",
		]);
		expect(model.nextCommand).toBe("refarm runtime ensure --wait --next-command");
	});
});
```

- [ ] **Step 2: Run the resolver test and verify it fails**

Run:

```bash
pnpm -C apps/refarm run test:file -- test/commands/base-surface-status.test.ts
```

Expected: FAIL because `base-surface-status.js` does not exist.

- [ ] **Step 3: Export the default runtime deps factory**

In `apps/refarm/src/commands/runtime.ts`, change:

```ts
function defaultDeps(): RuntimeCommandDeps {
```

to:

```ts
export function defaultRuntimeCommandDeps(): RuntimeCommandDeps {
```

Then change:

```ts
deps: RuntimeCommandDeps = defaultDeps(),
```

to:

```ts
deps: RuntimeCommandDeps = defaultRuntimeCommandDeps(),
```

- [ ] **Step 4: Implement the resolver**

Create `apps/refarm/src/commands/base-surface-status.ts` with:

```ts
import { buildCurrentModelEnvelope, defaultModelDeps } from "./model.js";
import { buildRuntimeJsonPayload, runtimeStatusPayload } from "./runtime-status.js";
import { defaultRuntimeCommandDeps } from "./runtime.js";
import { runHealthAudit } from "./health.js";
import {
	buildBaseSurfaceModel,
	type BaseSurfaceModel,
	type BaseSurfaceModelInput,
} from "./base-surface-model.js";

export interface BaseSurfaceStatusDeps {
	resolveRuntime?: () => Promise<BaseSurfaceModelInput["runtime"]>;
	resolveModel?: () => Promise<BaseSurfaceModelInput["model"]>;
	resolveHealth?: () => Promise<BaseSurfaceModelInput["health"]>;
}

export async function resolveBaseSurfaceStatus(
	deps: BaseSurfaceStatusDeps = {},
): Promise<BaseSurfaceModel> {
	const [runtime, model, health] = await Promise.all([
		(deps.resolveRuntime ?? resolveRuntimeBaseInput)(),
		(deps.resolveModel ?? resolveModelBaseInput)(),
		(deps.resolveHealth ?? resolveHealthBaseInput)(),
	]);
	return buildBaseSurfaceModel({ runtime, model, health });
}

async function resolveRuntimeBaseInput(): Promise<BaseSurfaceModelInput["runtime"]> {
	const payload = await runtimeStatusPayload(defaultRuntimeCommandDeps());
	return buildRuntimeJsonPayload(payload);
}

async function resolveModelBaseInput(): Promise<BaseSurfaceModelInput["model"]> {
	const tokens = await defaultModelDeps().loadTokens();
	return buildCurrentModelEnvelope(tokens);
}

async function resolveHealthBaseInput(): Promise<BaseSurfaceModelInput["health"]> {
	return runHealthAudit();
}
```

- [ ] **Step 5: Run resolver and runtime tests**

Run:

```bash
pnpm -C apps/refarm run test:file -- test/commands/base-surface-status.test.ts test/commands/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the resolver**

```bash
git add apps/refarm/src/commands/base-surface-status.ts apps/refarm/test/commands/base-surface-status.test.ts apps/refarm/src/commands/runtime.ts
git commit -m "feat(refarm): resolve daily-driver base status"
```

---

### Task 3: Wire `refarm status --base`

**Files:**
- Modify: `apps/refarm/src/commands/status.ts`
- Modify: `apps/refarm/test/commands/status.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Add this import to `apps/refarm/test/commands/status.test.ts` with the other
command imports:

```ts
import { createStatusCommand } from "../../src/commands/status.js";
```

Append these tests to `apps/refarm/test/commands/status.test.ts`:

```ts
	it("documents the zero-extension base status surface", () => {
		const command = createStatusCommand();
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("refarm status --base");
		expect(help).toContain("refarm status --base --json");
	});

	it("prints the base model as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createStatusCommand({
			resolveBaseSurfaceStatus: async () => ({
				schemaVersion: 1,
				command: "status",
				operation: "base",
				ok: false,
				units: [
					{
						id: "runtime",
						label: "Runtime",
						owner: "apps/refarm",
						state: "blocked",
						severity: "failure",
						summary: "Runtime sidecar is not ready.",
						evidence: [],
						actions: [
							{
								label: "refarm runtime ensure --wait --next-command",
								command: "refarm runtime ensure --wait --next-command",
								primary: true,
							},
						],
					},
				],
				nextAction: "refarm runtime ensure --wait --next-command",
				nextActions: ["refarm runtime ensure --wait --next-command"],
				nextCommand: "refarm runtime ensure --wait --next-command",
				nextCommands: ["refarm runtime ensure --wait --next-command"],
			}),
		});

		await command.parseAsync(["--base", "--json"], { from: "user" });

		expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({
			command: "status",
			operation: "base",
			ok: false,
			nextCommand: "refarm runtime ensure --wait --next-command",
		});
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		process.exitCode = undefined;
	});
```

- [ ] **Step 2: Run the status tests and verify they fail**

Run:

```bash
pnpm -C apps/refarm run test:file -- test/commands/status.test.ts
```

Expected: FAIL because `createStatusCommand` and `--base` do not exist.

- [ ] **Step 3: Add a status command factory and the `--base` option**

In `apps/refarm/src/commands/status.ts`, add imports:

```ts
import {
	formatBaseSurfaceModel,
	type BaseSurfaceModel,
} from "./base-surface-model.js";
import { resolveBaseSurfaceStatus } from "./base-surface-status.js";
```

Add these types near `ResolveStatusPayloadResult`:

```ts
export interface StatusCommandDeps {
	resolveBaseSurfaceStatus?: () => Promise<BaseSurfaceModel>;
}

interface StatusCommandOptions {
	json?: boolean;
	markdown?: boolean;
	renderer?: string;
	input?: string;
	action?: string;
	base?: boolean;
}
```

Wrap the existing `statusCommand` construction in a factory:

```ts
export function createStatusCommand(deps: StatusCommandDeps = {}): Command {
	return new Command("status")
		.description("Report host status")
		.option(
			"--input <path>",
			"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
		)
		.option(
			"--renderer <kind>",
			"Renderer mode: web | tui | headless",
			"headless",
		)
		.option("--markdown", "Output markdown report")
		.option("--json", "Output machine-readable JSON")
		.option("--base", "Output the zero-extension daily-driver base state")
		.option(
			"--action <id-or-index>",
			"Invoke a live app-owned status action by available action ID or row index",
		)
		.addHelpText(
			"after",
			`

Examples:
  $ refarm status
  $ refarm status --json
  $ refarm status --markdown
  $ refarm status --base
  $ refarm status --base --json
  $ refarm status --renderer web
  $ refarm status --input status.json --markdown
  $ refarm status --action inspect-trust

Notes:
  Use ${RUNTIME_STATUS_COMMAND} for runtime engine/readiness details.
  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.
  Use ${RUNTIME_DOCTOR_NEXT_COMMAND} for command-only recovery automation.
  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.
`,
		)
		.action(async (options: StatusCommandOptions) => {
			if (options.base) {
				await emitBaseStatus(options, deps);
				return;
			}
			if (options.action) {
				if (options.json || options.markdown) {
					throw new Error("--action cannot be combined with --json or --markdown.");
				}
				if (options.input) {
					throw new Error(
						"--action cannot be combined with --input; use refarm actions --input <path> --select <id-or-index> for dry-run readiness.",
					);
				}

				await emitStatusActionInvocation(options);
				return;
			}

			const outputMode = resolveJsonMarkdownStatusOutputMode({
				json: options.json,
				markdown: options.markdown,
				defaultMode: "summary",
			});

			await runStatusPreflight({
				resolveStatusPayload,
				resolveOptions: options,
				outputMode,
				printSummary: printStatusSummary,
			});
		});
}

export const statusCommand = createStatusCommand();
```

Add this helper below the command factory:

```ts
async function emitBaseStatus(
	options: Pick<StatusCommandOptions, "json" | "markdown" | "input" | "action">,
	deps: StatusCommandDeps,
): Promise<void> {
	if (options.input) {
		throw new Error("--base cannot be combined with --input.");
	}
	if (options.action) {
		throw new Error("--base cannot be combined with --action.");
	}
	if (options.markdown) {
		throw new Error("--base cannot be combined with --markdown.");
	}
	const model = await (deps.resolveBaseSurfaceStatus ?? resolveBaseSurfaceStatus)();
	if (options.json) {
		printJson(model);
	} else {
		console.log(formatBaseSurfaceModel(model));
	}
	if (!model.ok) {
		process.exitCode = 1;
	}
}
```

Remove the old inline status command declaration that begins with
`export const statusCommand = new Command("status")` after the factory has the
same existing behavior.

- [ ] **Step 4: Run status and model tests**

Run:

```bash
pnpm -C apps/refarm run test:file -- test/commands/status.test.ts test/commands/base-surface-model.test.ts test/commands/base-surface-status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Build the CLI package**

Run:

```bash
pnpm --filter @refarm.dev/refarm run build
```

Expected: PASS.

- [ ] **Step 6: Manually inspect the new base surface**

Run:

```bash
node apps/refarm/dist/index.js status --base --json
```

Expected in the current workspace if the sidecar is still down:

```json
{
  "schemaVersion": 1,
  "command": "status",
  "operation": "base",
  "ok": false,
  "nextCommand": "refarm runtime ensure --wait --next-command"
}
```

The exact `units` array may contain additional health or model evidence. The invariant is that runtime not-ready is represented as a `runtime` unit with `state: "blocked"` and a recovery command.

- [ ] **Step 7: Commit the CLI surface**

```bash
git add apps/refarm/src/commands/status.ts apps/refarm/test/commands/status.test.ts
git commit -m "feat(refarm): expose daily-driver base status"
```

---

### Task 4: Document The Manual Daily-Driver Base Walkthrough

**Files:**
- Modify: `docs/REFARM_OPERATOR_DAILY_DRIVER.md`

- [ ] **Step 1: Add the walkthrough section**

In `docs/REFARM_OPERATOR_DAILY_DRIVER.md`, add this section after "Start The Day":

````md
## Base Surface Acceptance

Use this loop before recording T1/T2/T3 material. It judges Refarm as a
zero-extension daily driver before any example app or plugin-specific surface is
allowed to compensate for base gaps.

```bash
refarm resume --json
refarm status --base --json
refarm runtime status --json
refarm model current --json
refarm check --next-action --json
```

Acceptance rules:

- `resume --json` is the continuity view and must expose useful `nextCommands`
  when the operator is blocked.
- `status --base --json` is the compact normalized base surface. It must include
  runtime, model, and health units when those probes are available.
- Runtime not-ready is acceptable only when the payload explains the sidecar
  probe and gives a recovery command.
- Model credentials and runtime readiness must be visible as separate units, so
  a configured model route does not hide a failed runtime sidecar.
- Health source visibility issues must remain base health issues; examples must
  not paper over them.
````

- [ ] **Step 2: Run markdown/diff checks**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Commit the walkthrough**

```bash
git add docs/REFARM_OPERATOR_DAILY_DRIVER.md
git commit -m "docs: add daily-driver base walkthrough"
```

---

### Task 5: Verify The Slice And Record Follow-Up Boundaries

**Files:**
- No source files unless verification reveals a concrete failure from Tasks 1-4.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm -C apps/refarm run test:file -- test/commands/base-surface-model.test.ts test/commands/base-surface-status.test.ts test/commands/status.test.ts test/commands/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package type-check**

Run:

```bash
pnpm --filter @refarm.dev/refarm run type-check
```

Expected: PASS.

- [ ] **Step 3: Run package build**

Run:

```bash
pnpm --filter @refarm.dev/refarm run build
```

Expected: PASS.

- [ ] **Step 4: Run the base manual command against built output**

Run:

```bash
node apps/refarm/dist/index.js status --base --json
```

Expected: valid JSON with:

```json
{
  "schemaVersion": 1,
  "command": "status",
  "operation": "base"
}
```

If `ok` is false because runtime is not ready or health has a source visibility issue, that is a valid current-state observation. The command must still expose `nextCommand` and structured `units`.

- [ ] **Step 5: Run repository finish gate**

Run:

```bash
refarm agent finish --lane after-edit --run --json
```

Expected: PASS, or a documented pre-existing blocker. If it fails with `node-substrate:cli-runtime-unavailable`, immediately run:

```bash
node scripts/ci/check-node-substrate.mjs --json
```

Expected for the recovery command: PASS. Record the mismatch in the final handoff instead of editing generated artifacts.

- [ ] **Step 6: Commit any verification-only fixes**

If Tasks 1-4 already produced all commits and no fixes were required, skip this step. If verification required a source fix, commit only the touched files:

```bash
git add apps/refarm/src/commands/base-surface-model.ts apps/refarm/src/commands/base-surface-status.ts apps/refarm/src/commands/runtime.ts apps/refarm/src/commands/status.ts apps/refarm/test/commands/base-surface-model.test.ts apps/refarm/test/commands/base-surface-status.test.ts apps/refarm/test/commands/status.test.ts docs/REFARM_OPERATOR_DAILY_DRIVER.md
git commit -m "fix(refarm): harden daily-driver base status"
```

- [ ] **Step 7: Run after-commit gate**

Run:

```bash
refarm agent finish --lane after-commit --run --json
```

Expected: PASS, or the same documented pre-existing blocker as Step 5.

---

## Follow-Up Plans After This Slice

After `refarm status --base` exists and is tested, write separate plans for:

1. TUI/Web renderers over the base surface model.
2. `apps/dev` and `apps/me` consuming the base model without owning semantics.
3. T1/T2/T3 migration from JSON-heavy examples onto the base surface.
4. WASM-backed provider pressure from T3 only after the base model makes the need visible.

These are intentionally outside this first implementation plan so the base can be judged before examples add domain-specific polish.
