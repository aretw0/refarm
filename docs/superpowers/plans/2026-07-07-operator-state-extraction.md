# Operator State Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the pure base surface/operator-state model from `apps/refarm` into `@refarm.dev/operator-state` so apps and examples can compose the same operator truth without importing app code.

**Architecture:** Create a new buildable TypeScript package that owns only JSON-safe types, normalization, unit/action/evidence composition, and handoff aggregation. Keep Node sampling and CLI rendering in `apps/refarm`: the app will collect runtime/model/health payloads, call the package builder, and render the output. This preserves current `refarm status --base --json` behavior while making the model usable by T1/T2/T3 and future hosts.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, turbo, existing `@refarm.dev/tsconfig` and `@refarm.dev/eslint-config`.

---

## File Structure

Create:

- `packages/operator-state/package.json` - public package metadata and scripts.
- `packages/operator-state/tsconfig.json` - buildable package type-check config.
- `packages/operator-state/tsconfig.build.json` - dist build config.
- `packages/operator-state/eslint.config.mjs` - package lint config.
- `packages/operator-state/src/index.ts` - pure operator-state types and builders.
- `packages/operator-state/src/index.test.ts` - behavior tests migrated from the app plus one non-Refarm consumer test.
- `packages/operator-state/src/boundary.test.ts` - dependency/boundary guard proving the package does not import app/runtime/CLI surfaces.
- `apps/refarm/src/commands/base-surface-output.ts` - app-local human formatter using `chalk`.
- `apps/refarm/test/commands/base-surface-output.test.ts` - app-local formatter test.

Modify:

- `apps/refarm/package.json` - add `@refarm.dev/operator-state`.
- `apps/refarm/src/commands/base-surface-status.ts` - import model types/builders from the package and pass `owner: "apps/refarm"`.
- `apps/refarm/src/commands/status.ts` - import `BaseSurfaceModel` from the package and formatting from `base-surface-output.ts`.
- `apps/refarm/test/commands/base-surface-status.test.ts` - import `BaseSurfaceModelInput` from the package.

Delete:

- `apps/refarm/src/commands/base-surface-model.ts` - model ownership moves to `packages/operator-state`.
- `apps/refarm/test/commands/base-surface-model.test.ts` - behavior moves to package tests; app keeps only output/status integration tests.

---

### Task 1: Scaffold `@refarm.dev/operator-state` With Red Tests

**Files:**
- Create: `packages/operator-state/package.json`
- Create: `packages/operator-state/tsconfig.json`
- Create: `packages/operator-state/tsconfig.build.json`
- Create: `packages/operator-state/eslint.config.mjs`
- Create: `packages/operator-state/src/index.ts`
- Create: `packages/operator-state/src/index.test.ts`
- Create: `packages/operator-state/src/boundary.test.ts`

- [ ] **Step 1: Create package scaffolding**

Create `packages/operator-state/package.json`:

```json
{
	"name": "@refarm.dev/operator-state",
	"version": "0.1.0",
	"description": "Pure operator state model and handoff normalization for Refarm-compatible hosts.",
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
		"test": "vitest run",
		"clean": "rm -rf dist"
	},
	"keywords": [
		"operator-state",
		"handoff",
		"surface",
		"refarm"
	],
	"license": "MIT",
	"files": [
		"dist",
		"!dist/**/*.tsbuildinfo",
		"README.md"
	],
	"publishConfig": {
		"access": "public"
	},
	"devDependencies": {
		"@refarm.dev/eslint-config": "workspace:*",
		"@refarm.dev/tsconfig": "workspace:*",
		"@refarm.dev/vtconfig": "workspace:*"
	}
}
```

Create `packages/operator-state/tsconfig.json`:

```json
{
	"extends": [
		"../../tsconfig.json",
		"@refarm.dev/tsconfig/buildable.json"
	],
	"compilerOptions": {
		"outDir": "dist",
		"rootDir": "src",
		"baseUrl": "../.."
	},
	"include": [
		"src/**/*"
	],
	"exclude": [
		"node_modules",
		"dist"
	]
}
```

Create `packages/operator-state/tsconfig.build.json`:

```json
{
	"extends": [
		"./tsconfig.json",
		"@refarm.dev/tsconfig/build.json"
	],
	"compilerOptions": {
		"rootDir": "src"
	},
	"exclude": [
		"src/**/*.test.ts"
	]
}
```

Create `packages/operator-state/eslint.config.mjs`:

```js
// @ts-check
import { withNode } from "@refarm.dev/eslint-config/node";

export default withNode(
	{
		ignores: ["dist/**", "**/*.d.ts"],
	},
	{
		files: ["src/**/*.ts"],
	},
);
```

Create `packages/operator-state/src/index.ts` as an intentionally empty module for the red test:

```ts
export {};
```

- [ ] **Step 2: Write the failing behavior test**

Create `packages/operator-state/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
	buildBaseSurfaceModel,
	type BaseSurfaceUnit,
} from "./index.js";

describe("operator state model", () => {
	it("marks runtime not-ready as the first blocking base unit", () => {
		const model = buildBaseSurfaceModel(
			{
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
			},
			{ owner: "apps/refarm" },
		);

		expect(model.ok).toBe(false);
		expect(model.nextCommand).toBe("refarm runtime ensure --wait --next-command");
		expect(model.units.map((unit) => unit.id)).toEqual([
			"runtime",
			"model",
			"health",
		]);
		expect(model.units[0]).toMatchObject({
			id: "runtime",
			owner: "apps/refarm",
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
			owner: "apps/refarm",
			state: "ready",
			severity: "info",
			summary: "Model route is configured.",
		});
	});

	it("keeps health policy failures actionable without inventing example-specific wording", () => {
		const model = buildBaseSurfaceModel(
			{
				health: {
					command: "health",
					operation: "audit",
					ok: false,
					issueCount: 1,
					recommendations: [
						{
							diagnostic: "git_ignored",
							issueType: "git_ignored",
							target:
								"packages/quality-checker-plugin/pkg-plugin/quality_plugin.js",
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
			},
			{ owner: "apps/refarm" },
		);

		expect(model.ok).toBe(false);
		expect(model.nextActions).toEqual([
			"Track the source file, or add an explicit health policy exclusion if it is generated.",
		]);
		expect(model.nextCommands).toEqual(["refarm health suggest-policy --json"]);
		expect(model.units[0]).toMatchObject({
			id: "health",
			owner: "apps/refarm",
			state: "blocked",
			severity: "failure",
			summary: "Workspace health has 1 blocking issue.",
		});
	});

	it("keeps runtime state coherent when the runtime reports ready with an issue", () => {
		const model = buildBaseSurfaceModel(
			{
				runtime: {
					command: "runtime",
					operation: "status",
					ok: false,
					configuredEngine: "rust",
					activeEngine: "unknown",
					ready: true,
					issue: "tractor.engine=rust but the Rust tractor binary is not built",
					nextCommand: "refarm config set tractor.engine auto",
					nextAction: "Select a usable runtime engine.",
				},
			},
			{ owner: "apps/refarm" },
		);

		expect(model.ok).toBe(false);
		expect(model.units[0]).toMatchObject({
			id: "runtime",
			owner: "apps/refarm",
			state: "blocked",
			severity: "failure",
			summary: "Runtime sidecar is not ready.",
		});
		expect(model.nextCommand).toBe("refarm config set tractor.engine auto");
		expect(model.nextAction).toBe("Select a usable runtime engine.");
	});

	it("dedupes plural and singular handoffs in runtime, model, health order", () => {
		const model = buildBaseSurfaceModel(
			{
				runtime: {
					command: "runtime",
					operation: "status",
					ok: false,
					ready: false,
					nextCommand: "refarm runtime status --json",
					nextCommands: ["refarm runtime status --json", "refarm resume --json"],
					nextAction: "Inspect runtime.",
					nextActions: ["Inspect runtime.", "Resume after runtime."],
				},
				model: {
					command: "model",
					operation: "current",
					ok: false,
					current: { ref: "openai-codex/gpt-5.3-codex-spark" },
					credential: { state: "missing" },
					nextCommand: "refarm sow --json",
					nextCommands: ["refarm runtime status --json", "refarm sow --json"],
					nextAction: "Configure credentials.",
					nextActions: ["Inspect runtime.", "Configure credentials."],
				},
				health: {
					command: "health",
					operation: "audit",
					ok: false,
					issueCount: 1,
					recommendations: [],
					nextCommand: "refarm health suggest-policy --json",
					nextCommands: ["refarm sow --json", "refarm health suggest-policy --json"],
					nextAction: "Fix health policy.",
					nextActions: ["Configure credentials.", "Fix health policy."],
				},
			},
			{ owner: "apps/refarm" },
		);

		expect(model.nextCommands).toEqual([
			"refarm runtime status --json",
			"refarm resume --json",
			"refarm sow --json",
			"refarm health suggest-policy --json",
		]);
		expect(model.nextActions).toEqual([
			"Inspect runtime.",
			"Resume after runtime.",
			"Configure credentials.",
			"Fix health policy.",
		]);
		expect(model.units[1]).toMatchObject({
			id: "model",
			owner: "apps/refarm",
			state: "blocked",
			severity: "failure",
			summary: "Model route is missing credentials.",
		});
	});

	it("lets non-Refarm consumers add domain units without app imports", () => {
		const walletUnit: BaseSurfaceUnit = {
			id: "wallet.verification",
			label: "Wallet Verification",
			owner: "examples/wallet-t2",
			state: "blocked",
			severity: "failure",
			summary: "Citizen wallet has records awaiting verification.",
			evidence: [{ kind: "count", label: "pending records", value: "2" }],
			actions: [
				{
					label: "Open wallet review queue.",
					command: "wallet-t2 review --pending --json",
					primary: true,
				},
			],
		};

		const model = buildBaseSurfaceModel({
			units: [walletUnit],
		});

		expect(model.ok).toBe(false);
		expect(model.units).toEqual([walletUnit]);
		expect(model.nextAction).toBe("Open wallet review queue.");
		expect(model.nextCommand).toBe("wallet-t2 review --pending --json");
	});
});
```

- [ ] **Step 3: Write the failing boundary test**

Create `packages/operator-state/src/boundary.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

describe("@refarm.dev/operator-state boundary", () => {
	it("does not import app, runtime, CLI, filesystem, HTTP, or renderer code", () => {
		const source = fs.readFileSync(path.join(packageRoot, "src/index.ts"), "utf-8");
		const forbidden = [
			"apps/refarm",
			"@refarm.dev/refarm",
			"@refarm.dev/runtime",
			"@refarm.dev/health",
			"@refarm.dev/sidecar-client",
			"@refarm.dev/storage-sqlite",
			"commander",
			"chalk",
			"node:fs",
			"node:path",
			"fetch(",
		];

		expect(
			forbidden.filter((token) => source.includes(token)),
		).toEqual([]);
	});
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
pnpm --filter @refarm.dev/operator-state exec vitest run src/index.test.ts src/boundary.test.ts
```

Expected: FAIL because `buildBaseSurfaceModel` and `BaseSurfaceUnit` are not exported from `src/index.ts`.

---

### Task 2: Implement The Pure Operator State Package

**Files:**
- Modify: `packages/operator-state/src/index.ts`
- Test: `packages/operator-state/src/index.test.ts`
- Test: `packages/operator-state/src/boundary.test.ts`

- [ ] **Step 1: Replace the empty package index with the pure model**

Replace `packages/operator-state/src/index.ts` with:

```ts
export type BaseSurfaceState =
	| "ready"
	| "degraded"
	| "blocked"
	| "unavailable"
	| "unknown";

export type BaseSurfaceSeverity = "info" | "warning" | "failure";

export interface BaseSurfaceEvidence {
	kind: string;
	label: string;
	value: string;
}

export interface BaseSurfaceAction {
	label: string;
	command: string;
	primary?: boolean;
}

export interface BaseSurfaceUnit {
	id: string;
	label: string;
	owner: string;
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
	command?: string;
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
	command?: string;
	operation?: string;
	current?: {
		ref?: string;
		provider?: string;
		modelId?: string;
	};
	credential?: {
		state?: string;
		status?: string | null;
		envKey?: string;
	};
	routes?: Record<string, unknown>;
	source?: unknown;
}

interface HealthLike extends CommandHandoffLike {
	command?: string;
	operation?: string;
	issueCount?: number;
}

export interface BaseSurfaceModelInput {
	runtime?: RuntimeLike;
	model?: ModelLike;
	health?: HealthLike;
	units?: BaseSurfaceUnit[];
}

export interface BaseSurfaceModelOptions {
	owner?: string;
	command?: string;
	operation?: string;
}

export interface BaseSurfaceModel {
	schemaVersion: 1;
	command: string;
	operation: string;
	ok: boolean;
	units: BaseSurfaceUnit[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export function buildBaseSurfaceModel(
	input: BaseSurfaceModelInput,
	options: BaseSurfaceModelOptions = {},
): BaseSurfaceModel {
	const owner = options.owner ?? "@refarm.dev/operator-state";
	const units = [
		input.runtime ? runtimeUnit(input.runtime, owner) : undefined,
		input.model ? modelUnit(input.model, owner) : undefined,
		input.health ? healthUnit(input.health, owner) : undefined,
		...(input.units ?? []),
	].filter((unit): unit is BaseSurfaceUnit => unit !== undefined);
	const nextActions = dedupe([
		...nextActionsFromHandoff(input.runtime),
		...nextActionsFromHandoff(input.model),
		...nextActionsFromHandoff(input.health),
		...units.flatMap((unit) => unit.actions.map((action) => action.label)),
	]);
	const nextCommands = dedupe([
		...nextCommandsFromHandoff(input.runtime),
		...nextCommandsFromHandoff(input.model),
		...nextCommandsFromHandoff(input.health),
		...units.flatMap((unit) => unit.actions.map((action) => action.command)),
	]);

	return {
		schemaVersion: 1,
		command: options.command ?? "status",
		operation: options.operation ?? "base",
		ok: units.every((unit) => unit.severity !== "failure"),
		units,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

function runtimeUnit(runtime: RuntimeLike, owner: string): BaseSurfaceUnit {
	const ready = runtime.ready === true;
	const blocked =
		runtime.ready === false || runtime.ok === false || Boolean(runtime.issue);
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
		owner,
		state: blocked ? "blocked" : ready ? "ready" : "unknown",
		severity: blocked ? "failure" : "info",
		summary: blocked
			? "Runtime sidecar is not ready."
			: ready
				? "Runtime sidecar is ready."
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

function modelUnit(model: ModelLike, owner: string): BaseSurfaceUnit {
	const missingCredential = model.credential?.state === "missing";
	const ref = model.current?.ref ?? "unknown";
	return {
		id: "model",
		label: "Model",
		owner,
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
							kind: "state",
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

function healthUnit(health: HealthLike, owner: string): BaseSurfaceUnit {
	const issueCount = health.issueCount ?? 0;
	const blocked = health.ok === false || issueCount > 0;
	return {
		id: "health",
		label: "Health",
		owner,
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
			? [{ kind: "state", label: "recommendation", value: first.summary }]
			: []),
		...(first.target
			? [{ kind: "path", label: "target", value: first.target }]
			: []),
	];
}

function actionsFromHandoff(handoff: CommandHandoffLike): BaseSurfaceAction[] {
	const commands = nextCommandsFromHandoff(handoff);
	const actions = nextActionsFromHandoff(handoff);
	return commands.map((command, index) => ({
		label: actions[index] ?? command,
		command,
		...(index === 0 ? { primary: true } : {}),
	}));
}

function nextActionsFromHandoff(handoff?: CommandHandoffLike): string[] {
	if (!handoff) return [];
	return dedupe([
		...(handoff.nextAction ? [handoff.nextAction] : []),
		...(handoff.nextActions ?? []),
	]);
}

function nextCommandsFromHandoff(handoff?: CommandHandoffLike): string[] {
	if (!handoff) return [];
	return dedupe([
		...(handoff.nextCommand ? [handoff.nextCommand] : []),
		...(handoff.nextCommands ?? []),
	]);
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
```

- [ ] **Step 2: Run package tests**

Run:

```bash
pnpm --filter @refarm.dev/operator-state exec vitest run src/index.test.ts src/boundary.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run package type-check and build**

Run:

```bash
pnpm --filter @refarm.dev/operator-state run type-check
pnpm --filter @refarm.dev/operator-state run build
```

Expected: both PASS. `dist/index.js` and `.d.ts` are generated by build; do not manually edit generated files.

- [ ] **Step 4: Commit the pure package**

Run:

```bash
git add packages/operator-state
git commit -m "feat(operator-state): add pure base surface model"
```

---

### Task 3: Move Human Formatting Back To `apps/refarm`

**Files:**
- Create: `apps/refarm/src/commands/base-surface-output.ts`
- Create: `apps/refarm/test/commands/base-surface-output.test.ts`
- Delete: `apps/refarm/test/commands/base-surface-model.test.ts`

- [ ] **Step 1: Create the app-local formatter**

Create `apps/refarm/src/commands/base-surface-output.ts`:

```ts
import type { BaseSurfaceModel } from "@refarm.dev/operator-state";
import chalk from "chalk";

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

- [ ] **Step 2: Create the formatter test**

Create `apps/refarm/test/commands/base-surface-output.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildBaseSurfaceModel } from "@refarm.dev/operator-state";
import { formatBaseSurfaceModel } from "../../src/commands/base-surface-output.js";

describe("formatBaseSurfaceModel", () => {
	it("formats a compact human summary for manual exploration", () => {
		const model = buildBaseSurfaceModel(
			{
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
			},
			{ owner: "apps/refarm" },
		);

		const output = formatBaseSurfaceModel(model);

		expect(output).toContain("Refarm base: ready");
		expect(output).toContain("runtime  ready");
		expect(output).toContain("health   ready");
	});
});
```

- [ ] **Step 3: Delete the old app model test**

Delete `apps/refarm/test/commands/base-surface-model.test.ts`.

- [ ] **Step 4: Run the new formatter test and verify it fails before app imports are rewired**

Run:

```bash
pnpm --filter @refarm.dev/operator-state run build
pnpm -C apps/refarm run test:file -- test/commands/base-surface-output.test.ts
```

Expected: PASS if the package build is available. If it fails because `@refarm.dev/operator-state` is not declared in `apps/refarm/package.json`, proceed to Task 4 before rerunning.

---

### Task 4: Rewire `apps/refarm` To Consume `@refarm.dev/operator-state`

**Files:**
- Modify: `apps/refarm/package.json`
- Modify: `apps/refarm/src/commands/base-surface-status.ts`
- Modify: `apps/refarm/src/commands/status.ts`
- Modify: `apps/refarm/test/commands/base-surface-status.test.ts`
- Delete: `apps/refarm/src/commands/base-surface-model.ts`

- [ ] **Step 1: Add package dependency**

In `apps/refarm/package.json`, add this dependency in the existing `"dependencies"` object:

```json
"@refarm.dev/operator-state": "workspace:*"
```

Keep the object sorted in the local style after running `refarm tidy imports` if the repository tooling adjusts order.

- [ ] **Step 2: Update `base-surface-status.ts` imports and builder call**

Change the top imports in `apps/refarm/src/commands/base-surface-status.ts` to:

```ts
import {
	buildBaseSurfaceModel,
	type BaseSurfaceModel,
	type BaseSurfaceModelInput,
} from "@refarm.dev/operator-state";
import { runHealthAudit } from "./health.js";
import { buildCurrentModelEnvelope, defaultModelDeps } from "./model.js";
import {
	buildRuntimeJsonPayload,
	runtimeStatusPayload,
} from "./runtime-status.js";
import { defaultRuntimeCommandDeps } from "./runtime.js";
```

Change the return line in `resolveBaseSurfaceStatus` to:

```ts
return buildBaseSurfaceModel({ runtime, model, health }, { owner: "apps/refarm" });
```

- [ ] **Step 3: Update `status.ts` imports**

Replace the current base model import block in `apps/refarm/src/commands/status.ts`:

```ts
import {
	formatBaseSurfaceModel,
	type BaseSurfaceModel,
} from "./base-surface-model.js";
```

with:

```ts
import type { BaseSurfaceModel } from "@refarm.dev/operator-state";
import { formatBaseSurfaceModel } from "./base-surface-output.js";
```

- [ ] **Step 4: Update the status resolver test type import**

In `apps/refarm/test/commands/base-surface-status.test.ts`, replace:

```ts
import type { BaseSurfaceModelInput } from "../../src/commands/base-surface-model.js";
```

with:

```ts
import type { BaseSurfaceModelInput } from "@refarm.dev/operator-state";
```

- [ ] **Step 5: Delete the old app-local model file**

Delete `apps/refarm/src/commands/base-surface-model.ts`.

- [ ] **Step 6: Run the focused app tests**

Run:

```bash
pnpm --filter @refarm.dev/operator-state run build
pnpm -C apps/refarm run test:file -- test/commands/base-surface-output.test.ts test/commands/base-surface-status.test.ts test/commands/status.test.ts test/commands/runtime.test.ts
```

Expected: PASS. This replaces the old `base-surface-model.test.ts` app coverage with package tests plus app formatting/status integration.

- [ ] **Step 7: Run app type-check and build**

Run:

```bash
pnpm --filter @refarm.dev/operator-state run build
pnpm --filter @refarm.dev/refarm run type-check
pnpm --filter @refarm.dev/refarm run build
```

Expected: all PASS.

- [ ] **Step 8: Commit the app rewire**

Run:

```bash
git add apps/refarm/package.json apps/refarm/src/commands/base-surface-status.ts apps/refarm/src/commands/status.ts apps/refarm/src/commands/base-surface-output.ts apps/refarm/test/commands/base-surface-status.test.ts apps/refarm/test/commands/base-surface-output.test.ts
git add -u apps/refarm/src/commands/base-surface-model.ts apps/refarm/test/commands/base-surface-model.test.ts
git commit -m "refactor(refarm): consume operator-state base model"
```

---

### Task 5: Prove The Package Boundary And Manual Daily-Driver Behavior

**Files:**
- No source edits expected.

- [ ] **Step 1: Run package validation**

Run:

```bash
pnpm --filter @refarm.dev/operator-state exec vitest run src/index.test.ts src/boundary.test.ts
pnpm --filter @refarm.dev/operator-state run type-check
pnpm --filter @refarm.dev/operator-state run build
pnpm --filter @refarm.dev/operator-state run lint
```

Expected: all PASS.

- [ ] **Step 2: Run app validation**

Run:

```bash
pnpm -C apps/refarm run test:file -- test/commands/base-surface-output.test.ts test/commands/base-surface-status.test.ts test/commands/status.test.ts test/commands/runtime.test.ts
pnpm --filter @refarm.dev/refarm run type-check
pnpm --filter @refarm.dev/refarm run build
```

Expected: all PASS.

- [ ] **Step 3: Run workspace hygiene**

Run:

```bash
git diff --check
refarm tidy imports --check --json
```

Expected: both PASS.

- [ ] **Step 4: Run manual compiled daily-driver check**

Run:

```bash
node apps/refarm/dist/index.js status --base --json
```

Expected: command reaches the `status --base` handler and prints a `schemaVersion: 1` JSON payload with `runtime`, `model`, and `health` units. Exit code may be `1` when health has the known generated-plugin visibility issue; that is acceptable if the payload includes `nextCommands` and no bootstrap error.

- [ ] **Step 5: Run agent finish after-edit**

Run:

```bash
refarm agent finish --lane after-edit --run --json
```

Expected: `tidy-imports-check` passes. If it fails at `health`, follow:

```bash
refarm health suggest-policy --json
```

The known health failure is the generated plugin JS visibility policy. Do not edit generated files or broaden this slice to fix health policy unless the user explicitly approves that scope.

- [ ] **Step 6: Commit any verification-only corrections**

If Tasks 5.1 through 5.5 required small source corrections, commit them:

```bash
git add <changed-source-files>
git commit -m "fix(operator-state): harden extraction boundary"
```

Expected: skip this step if `git status --short` is clean.

- [ ] **Step 7: Run after-commit handoff**

Run:

```bash
refarm agent finish --lane after-commit --run --json
```

Expected: same as after-edit. If health remains the only failure, run:

```bash
refarm health suggest-policy --json
```

Record the known health blocker in the final response.

---

## Self-Review

Spec coverage:

- The plan creates `@refarm.dev/operator-state` as the neutral pure package.
- The plan keeps runtime/model/health sampling in `apps/refarm`.
- The plan moves human formatting into app-local `base-surface-output.ts`.
- The plan removes app ownership of the core model file.
- The plan includes a non-Refarm consumer unit test using `examples/wallet-t2`.
- The plan includes a boundary test blocking imports of app/runtime/CLI/filesystem/sidecar dependencies.
- The plan preserves `refarm status --base --json` behavior through focused app tests and manual compiled validation.

Placeholder scan:

- No placeholder steps are required for implementation.
- Every source edit in the plan names exact files and expected code.
- The only optional command is the correction commit in Task 5, guarded by actual `git status`.

Type consistency:

- `BaseSurfaceModel`, `BaseSurfaceModelInput`, and `BaseSurfaceUnit` are exported from `@refarm.dev/operator-state`.
- `buildBaseSurfaceModel(input, { owner: "apps/refarm" })` preserves the current `owner` value in Refarm output.
- The package model allows future unit ids and owners as strings rather than hard-coded app unions.
