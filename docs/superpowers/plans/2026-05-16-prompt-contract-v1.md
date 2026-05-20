# prompt-contract-v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/prompt-contract-v1` — a typed operator-prompt primitive (`OperatorChannel`) that replaces ad-hoc `confirm()` calls across the CLI, with stdio, auto, and scripted implementations; then wire it into `session-launch.ts`.

**Architecture:** A discriminated-union `OperatorPrompt` type (`confirm | select | text`) drives an `OperatorChannel` interface with overloaded `ask()`. Three implementations ship with the contract: `createStdioOperatorChannel` (readline, no deps), `createAutoOperatorChannel` (returns defaults silently — CI mode), and `createScriptedOperatorChannel` (predefined answers queue — for tests). `LaunchDeps.confirm` is replaced with `LaunchDeps.operator: OperatorChannel`.

**Tech Stack:** TypeScript, Node.js `readline` (built-in, no external deps), Vitest.

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `packages/prompt-contract-v1/package.json` | Create | Package manifest (mirrors event-contract-v1) |
| `packages/prompt-contract-v1/tsconfig.json` | Create | TS config (mirrors event-contract-v1) |
| `packages/prompt-contract-v1/src/index.ts` | Create | All types + 3 implementations + conformance runner |
| `packages/prompt-contract-v1/src/index.test.ts` | Create | Unit tests for all implementations |
| `apps/refarm/package.json` | Modify | Add `@refarm.dev/prompt-contract-v1` dependency |
| `apps/refarm/src/commands/session-launch.ts` | Modify | Replace `confirm()` with `operator: OperatorChannel` |
| `apps/refarm/src/commands/session-launch.test.ts` | Modify | Update `makeLaunchDeps` to use scripted channel |

---

### Task 1: Create `packages/prompt-contract-v1` — types + implementations + tests

**Files:**
- Create: `packages/prompt-contract-v1/package.json`
- Create: `packages/prompt-contract-v1/tsconfig.json`
- Create: `packages/prompt-contract-v1/src/index.ts`
- Create: `packages/prompt-contract-v1/src/index.test.ts`

#### Context

This package follows the exact same structure as `packages/event-contract-v1`. Its `package.json` uses `"main": "./src/index.ts"` and `"exports": { ".": "./src/index.ts" }` — TypeScript-first, no build step required. The `pnpm-workspace.yaml` already has `"packages/*"` so no workspace config change is needed.

The `OperatorChannel` interface is overloaded: the return type is narrowed by the prompt's `type` discriminant. TypeScript resolves overloaded function signatures top-to-bottom — the narrow overloads must come before the wide fallback.

`createScriptedOperatorChannel` is the test utility: it takes an array of `boolean | string` answers and returns them in order on each `ask()` call. It throws `RangeError` if the queue is exhausted — this makes test bugs visible immediately.

`runOperatorChannelConformance` accepts any `OperatorChannel` and tests it against the three prompt types. It works correctly with `createAutoOperatorChannel` (which returns defaults synchronously, never prompts). It does NOT test `createStdioOperatorChannel` — stdio channels cannot be meaningfully conformance-tested without a terminal.

- [ ] **Step 1: Write the failing tests**

Create `packages/prompt-contract-v1/src/index.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
	PROMPT_CAPABILITY,
	createAutoOperatorChannel,
	createScriptedOperatorChannel,
	runOperatorChannelConformance,
} from "./index.js";

describe("PROMPT_CAPABILITY", () => {
	it("is prompt:v1", () => {
		expect(PROMPT_CAPABILITY).toBe("prompt:v1");
	});
});

describe("createAutoOperatorChannel", () => {
	it("returns default for confirm (false)", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "confirm", question: "ok?", default: false })).toBe(false);
	});

	it("returns true when no default on confirm", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "confirm", question: "ok?" })).toBe(true);
	});

	it("returns default for select", async () => {
		const ch = createAutoOperatorChannel();
		const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
		expect(
			await ch.ask({ type: "select", question: "pick", options: opts, default: "b" }),
		).toBe("b");
	});

	it("returns first option when no default on select", async () => {
		const ch = createAutoOperatorChannel();
		const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
		expect(await ch.ask({ type: "select", question: "pick", options: opts })).toBe("a");
	});

	it("returns empty string when select has no options", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "select", question: "pick", options: [] })).toBe("");
	});

	it("returns default for text", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "text", question: "name?", default: "alice" })).toBe("alice");
	});

	it("returns empty string when no default on text", async () => {
		const ch = createAutoOperatorChannel();
		expect(await ch.ask({ type: "text", question: "name?" })).toBe("");
	});
});

describe("createScriptedOperatorChannel", () => {
	it("returns answers in sequence", async () => {
		const ch = createScriptedOperatorChannel([true, "openai", "sk-test"]);
		const opts = [{ value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" }];
		expect(await ch.ask({ type: "confirm", question: "ok?" })).toBe(true);
		expect(await ch.ask({ type: "select", question: "provider?", options: opts })).toBe("openai");
		expect(await ch.ask({ type: "text", question: "key?" })).toBe("sk-test");
	});

	it("throws RangeError when answers are exhausted", async () => {
		const ch = createScriptedOperatorChannel([]);
		await expect(ch.ask({ type: "confirm", question: "ok?" })).rejects.toThrow(RangeError);
	});

	it("works with a single answer", async () => {
		const ch = createScriptedOperatorChannel([false]);
		expect(await ch.ask({ type: "confirm", question: "proceed?" })).toBe(false);
	});
});

describe("runOperatorChannelConformance", () => {
	it("passes for createAutoOperatorChannel", async () => {
		const result = await runOperatorChannelConformance(createAutoOperatorChannel());
		expect(result.pass).toBe(true);
		expect(result.total).toBe(3);
		expect(result.failures).toEqual([]);
	});

	it("passes for createScriptedOperatorChannel with matching answers", async () => {
		// Script must match what conformance will ask: confirm(true), select("a"), text("hello")
		const ch = createScriptedOperatorChannel([true, "a", "hello"]);
		const result = await runOperatorChannelConformance(ch);
		expect(result.pass).toBe(true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/prompt-contract-v1 && pnpm exec vitest run src/index.test.ts 2>&1 | head -20
```

Expected: error about missing package or module not found.

- [ ] **Step 3: Create package manifests**

Create `packages/prompt-contract-v1/package.json`:

```json
{
  "name": "@refarm.dev/prompt-contract-v1",
  "version": "0.1.0",
  "private": true,
  "description": "Typed operator-prompt primitive — confirm, select, and text prompts across CLI, TUI, and web surfaces",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```

Create `packages/prompt-contract-v1/tsconfig.json`:

```json
{
	"extends": "@refarm.dev/tsconfig/node.json",
	"compilerOptions": {
		"noEmit": true
	},
	"include": [
		"src/**/*.ts"
	]
}
```

- [ ] **Step 4: Implement `src/index.ts`**

Create `packages/prompt-contract-v1/src/index.ts`:

```typescript
import readline from "node:readline";

export const PROMPT_CAPABILITY = "prompt:v1" as const;

// ── Prompt types ──────────────────────────────────────────────────────────────

export interface SelectOption {
	value: string;
	label: string;
	description?: string;
}

export interface ConfirmPrompt {
	type: "confirm";
	question: string;
	/** Default answer when the user presses Enter. Defaults to true. */
	default?: boolean;
}

export interface SelectPrompt {
	type: "select";
	question: string;
	options: SelectOption[];
	/** Value of the pre-selected option. Defaults to first option. */
	default?: string;
}

export interface TextPrompt {
	type: "text";
	question: string;
	/** Returned when the user submits an empty answer. */
	default?: string;
	/** Shown as a hint inside the prompt (does not constrain input). */
	placeholder?: string;
}

export type OperatorPrompt = ConfirmPrompt | SelectPrompt | TextPrompt;

// ── OperatorChannel ───────────────────────────────────────────────────────────

export interface OperatorChannel {
	ask(prompt: ConfirmPrompt): Promise<boolean>;
	ask(prompt: SelectPrompt): Promise<string>;
	ask(prompt: TextPrompt): Promise<string>;
	ask(prompt: OperatorPrompt): Promise<boolean | string>;
}

// ── createAutoOperatorChannel ─────────────────────────────────────────────────
// Returns the `default` value for every prompt without prompting. Use in
// non-interactive environments (CI, automated scripts).

export function createAutoOperatorChannel(): OperatorChannel {
	return {
		async ask(prompt: OperatorPrompt): Promise<boolean | string> {
			if (prompt.type === "confirm") return prompt.default ?? true;
			if (prompt.type === "select") return prompt.default ?? prompt.options[0]?.value ?? "";
			return prompt.default ?? "";
		},
	};
}

// ── createScriptedOperatorChannel ────────────────────────────────────────────
// Returns predefined answers in sequence. Throws RangeError if exhausted.
// Use in tests to drive an OperatorChannel without stdin.

export function createScriptedOperatorChannel(
	answers: Array<boolean | string>,
): OperatorChannel {
	const queue = [...answers];
	return {
		async ask(_prompt: OperatorPrompt): Promise<boolean | string> {
			if (queue.length === 0) {
				throw new RangeError("createScriptedOperatorChannel: answer queue exhausted");
			}
			return queue.shift()!;
		},
	};
}

// ── createStdioOperatorChannel ────────────────────────────────────────────────
// Interactive readline implementation. No external dependencies.
// Renders confirm as Y/n, select as a numbered list, text as a free-form field.

export function createStdioOperatorChannel(): OperatorChannel {
	return {
		async ask(prompt: OperatorPrompt): Promise<boolean | string> {
			if (prompt.type === "confirm") return askConfirm(prompt);
			if (prompt.type === "select") return askSelect(prompt);
			return askText(prompt);
		},
	};
}

function askConfirm(prompt: ConfirmPrompt): Promise<boolean> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const hint = prompt.default === false ? "(y/N)" : "(Y/n)";
	return new Promise((resolve) => {
		rl.question(`${prompt.question} ${hint} `, (answer) => {
			rl.close();
			const t = answer.trim().toLowerCase();
			if (!t) resolve(prompt.default ?? true);
			else resolve(t !== "n" && t !== "no");
		});
	});
}

function askSelect(prompt: SelectPrompt): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	process.stdout.write(`${prompt.question}\n`);
	prompt.options.forEach((opt, i) => {
		const marker = opt.value === prompt.default ? "▶" : " ";
		const desc = opt.description ? `  — ${opt.description}` : "";
		process.stdout.write(`  ${marker} ${i + 1}. ${opt.label}${desc}\n`);
	});
	const defaultIndex =
		prompt.default !== undefined
			? prompt.options.findIndex((o) => o.value === prompt.default) + 1
			: 1;
	const effectiveDefault = defaultIndex > 0 ? defaultIndex : 1;

	return new Promise((resolve) => {
		rl.question(`Enter number (${effectiveDefault}): `, (answer) => {
			rl.close();
			const t = answer.trim();
			if (!t) {
				resolve(prompt.default ?? prompt.options[0]?.value ?? "");
				return;
			}
			const n = parseInt(t, 10);
			const opt = Number.isFinite(n) ? prompt.options[n - 1] : undefined;
			resolve(opt?.value ?? prompt.default ?? prompt.options[0]?.value ?? "");
		});
	});
}

function askText(prompt: TextPrompt): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const hint = prompt.placeholder
		? ` (${prompt.placeholder})`
		: prompt.default
			? ` [${prompt.default}]`
			: "";
	return new Promise((resolve) => {
		rl.question(`${prompt.question}${hint}: `, (answer) => {
			rl.close();
			resolve(answer.trim() || prompt.default || "");
		});
	});
}

// ── Conformance runner ────────────────────────────────────────────────────────

export interface OperatorChannelConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

export async function runOperatorChannelConformance(
	channel: OperatorChannel,
): Promise<OperatorChannelConformanceResult> {
	const failures: string[] = [];
	const total = 3;

	// 1 — confirm returns boolean
	try {
		const result = await channel.ask({ type: "confirm", question: "_conformance_", default: true });
		if (typeof result !== "boolean") failures.push("confirm: did not return boolean");
	} catch (e) {
		failures.push(`confirm threw: ${String(e)}`);
	}

	// 2 — select returns a value present in options
	try {
		const opts: SelectOption[] = [
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		];
		const result = await channel.ask({
			type: "select",
			question: "_conformance_",
			options: opts,
			default: "a",
		});
		if (typeof result !== "string") failures.push("select: did not return string");
		else if (!opts.some((o) => o.value === result))
			failures.push(`select: returned value not in options: "${result}"`);
	} catch (e) {
		failures.push(`select threw: ${String(e)}`);
	}

	// 3 — text returns string
	try {
		const result = await channel.ask({
			type: "text",
			question: "_conformance_",
			default: "hello",
		});
		if (typeof result !== "string") failures.push("text: did not return string");
	} catch (e) {
		failures.push(`text threw: ${String(e)}`);
	}

	const failed = failures.length;
	return { pass: failed === 0, total, failed, failures };
}
```

- [ ] **Step 5: Run the tests — they should pass**

```bash
pnpm --filter @refarm.dev/prompt-contract-v1 install
cd packages/prompt-contract-v1 && pnpm exec vitest run src/index.test.ts --reporter=verbose 2>&1
```

Expected output:
```
✓ PROMPT_CAPABILITY > is prompt:v1
✓ createAutoOperatorChannel > returns default for confirm (false)
✓ createAutoOperatorChannel > returns true when no default on confirm
✓ createAutoOperatorChannel > returns default for select
✓ createAutoOperatorChannel > returns first option when no default on select
✓ createAutoOperatorChannel > returns empty string when select has no options
✓ createAutoOperatorChannel > returns default for text
✓ createAutoOperatorChannel > returns empty string when no default on text
✓ createScriptedOperatorChannel > returns answers in sequence
✓ createScriptedOperatorChannel > throws RangeError when answers are exhausted
✓ createScriptedOperatorChannel > works with a single answer
✓ runOperatorChannelConformance > passes for createAutoOperatorChannel
✓ runOperatorChannelConformance > passes for createScriptedOperatorChannel with matching answers
Tests  13 passed (13)
```

- [ ] **Step 6: Commit**

```bash
git add packages/prompt-contract-v1/
git commit -m "feat(prompt-contract-v1): typed OperatorChannel primitive — confirm, select, text"
```

---

### Task 2: Wire `OperatorChannel` into `apps/refarm`

**Files:**
- Modify: `apps/refarm/package.json` — add dependency
- Modify: `apps/refarm/src/commands/session-launch.ts` — replace `confirm()` with `operator: OperatorChannel`
- Modify: `apps/refarm/src/commands/session-launch.test.ts` — update `makeLaunchDeps`

#### Context

`LaunchDeps` in `session-launch.ts` currently has:
```typescript
confirm(question: string): Promise<boolean>;
```

This becomes:
```typescript
operator: OperatorChannel;
```

There are exactly **three** call sites for `deps.confirm(...)`:
1. `autoStartFarmhand` (line ~181): `deps.confirm("   Start it now? (Y/n)")`
2. `defaultLaunchDeps().recoverProvider` (line ~149): `deps.confirm("   Configure now? (Y/n)")`
3. `defaultLaunchDeps().confirm` — this is the *implementation*, not a call site; it disappears

Replace each call with:
```typescript
deps.operator.ask({ type: "confirm", question: "   Start it now?", default: true })
```

`defaultLaunchDeps()` no longer creates a readline interface for `confirm`. Instead it sets:
```typescript
operator: createStdioOperatorChannel(),
```

The `readline` import in `session-launch.ts` can be removed entirely — `createStdioOperatorChannel` owns it now.

In `recoverProvider`, `deps.confirm(...)` becomes `deps.operator.ask({ type: "confirm", ... })`. Note that `recoverProvider` is a closure capturing `deps`, so `deps.operator` is accessible.

In the test file, `makeLaunchDeps` currently sets `confirm: vi.fn().mockResolvedValue(true)`. This becomes injecting a scripted channel:
```typescript
import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
// ...
operator: createScriptedOperatorChannel([true]),  // default: user says yes to everything
```

For tests that need the user to say **no**, pass `createScriptedOperatorChannel([false])`.

The existing tests each call `autoStartFarmhand` once (one confirm prompt), so each needs exactly one answer in the queue. The `autostartMode: "always"` and `autostartMode: "never"` tests never call `ask()` at all, so an empty scripted channel is fine for them.

- [ ] **Step 1: Add the dependency**

In `apps/refarm/package.json`, add to `"dependencies"`:
```json
"@refarm.dev/prompt-contract-v1": "workspace:*",
```

Run:
```bash
pnpm install
```

- [ ] **Step 2: Update `session-launch.ts`**

Replace the entire file content. Key changes vs current:
- Remove `readline` import
- Add `import { type OperatorChannel, createStdioOperatorChannel } from "@refarm.dev/prompt-contract-v1";`
- `LaunchDeps`: remove `confirm`, add `operator: OperatorChannel`
- `defaultLaunchDeps`: remove `confirm()` method, add `operator: createStdioOperatorChannel()`; in `recoverProvider`, use `deps.operator.ask(...)`
- `autoStartFarmhand`: `deps.confirm(...)` → `deps.operator.ask({ type: "confirm", question: "   Start it now?", default: true })`

Full updated file:

```typescript
/**
 * Session launch policy — readiness check, auto-start, and guide output.
 * No readline REPL, no Commander. Just policy.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
	type OperatorChannel,
	createStdioOperatorChannel,
} from "@refarm.dev/prompt-contract-v1";

const SIDECAR_URL = "http://127.0.0.1:42001";
const FARMHAND_PROBE_TIMEOUT_MS = 1_500;
const AUTOSTART_POLL_INTERVAL_MS = 300;
const AUTOSTART_TIMEOUT_MS = 10_000;

export interface SessionReadiness {
	providerConfigured: boolean;
	farmhandRunning: boolean;
}

export type AutostartMode = "always" | "ask" | "never";

export interface LaunchDeps {
	operator: OperatorChannel;
	spawnFarmhand(repoRoot: string): void;
	probeFarmhandUntilReady(): Promise<boolean>;
	/** How to handle farmhand auto-start. Reads from config.json; default "ask". */
	autostartMode?: AutostartMode;
	/** Called when no provider is configured — returns true if provider is now ready. */
	recoverProvider?(): Promise<boolean>;
}

export function isSessionReady(r: SessionReadiness): boolean {
	return r.providerConfigured && r.farmhandRunning;
}

export function isFirstRun(): boolean {
	for (const base of refarmSearchDirs()) {
		if (fs.existsSync(path.join(base, ".env"))) return false;
		if (fs.existsSync(path.join(base, "config.json"))) return false;
	}
	return true;
}

export async function checkSessionReadiness(): Promise<SessionReadiness> {
	const providerConfigured = detectProvider();
	const farmhandRunning = await probeFarmhand();
	return { providerConfigured, farmhandRunning };
}

// Exported for tests — returns dirs to search for .refarm config, home first.
export function refarmSearchDirs(): string[] {
	return [
		path.join(os.homedir(), ".refarm"),
		path.join(process.cwd(), ".refarm"),
	];
}

function detectProvider(): boolean {
	if (process.env.MODEL_PROVIDER) return true;

	for (const base of refarmSearchDirs()) {
		if (fs.existsSync(path.join(base, ".env"))) return true;

		const configFile = path.join(base, "config.json");
		if (fs.existsSync(configFile)) {
			try {
				const config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as {
					provider?: string;
					default_provider?: string;
				};
				if (config.provider ?? config.default_provider) return true;
			} catch {
				// continue to next dir
			}
		}
	}

	return false;
}

/** Read autostart preference from the nearest .refarm/config.json. */
export function readAutostartMode(): AutostartMode {
	for (const base of refarmSearchDirs()) {
		const configFile = path.join(base, "config.json");
		if (!fs.existsSync(configFile)) continue;
		try {
			const config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as {
				autostart?: string;
			};
			if (config.autostart === "always" || config.autostart === "never") {
				return config.autostart;
			}
		} catch {
			// ignore malformed config
		}
	}
	return "ask";
}

/** Compute the monorepo root from this file's location. */
export function findRepoRoot(): string {
	const __filename = fileURLToPath(import.meta.url);
	// apps/refarm/src/commands/ → up 4 levels → repo root
	return path.resolve(path.dirname(__filename), "../../../../");
}

export function defaultLaunchDeps(): LaunchDeps {
	const deps: LaunchDeps = {
		autostartMode: readAutostartMode(),
		operator: createStdioOperatorChannel(),

		spawnFarmhand(repoRoot) {
			const child = spawn(
				"bash",
				[path.join(repoRoot, "scripts", "farmhand-start.sh"), "--background"],
				{ detached: true, stdio: "ignore" },
			);
			child.unref();
		},

		async probeFarmhandUntilReady() {
			const deadline = Date.now() + AUTOSTART_TIMEOUT_MS;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, AUTOSTART_POLL_INTERVAL_MS));
				if (await probeFarmhand()) return true;
			}
			return false;
		},

		async recoverProvider() {
			process.stderr.write(chalk.red("✗  No model provider configured.\n\n"));
			const go = await deps.operator.ask({ type: "confirm", question: "   Configure now?", default: true });
			if (!go) {
				console.error(chalk.dim("   Run `refarm sow` when ready."));
				return false;
			}
			// Re-invoke the same CLI binary with the `sow` subcommand.
			// process.argv[0] = node binary, process.argv[1] = refarm entry script.
			spawnSync(process.argv[0]!, [process.argv[1]!, "sow"], { stdio: "inherit" });
			return detectProvider();
		},
	};
	return deps;
}

/**
 * Offer to auto-start farmhand when the provider is configured but farmhand
 * is not running (ADR-065, Phase 1). Returns true if farmhand is now ready.
 */
export async function autoStartFarmhand(
	repoRoot: string,
	deps: LaunchDeps,
): Promise<boolean> {
	const mode = deps.autostartMode ?? "ask";

	if (mode === "never") {
		process.stderr.write(chalk.red("✗  Farmhand is not running.\n"));
		console.error(chalk.dim("   Diagnose:  refarm doctor"));
		return false;
	}

	process.stderr.write(chalk.red("✗  Farmhand is not running.\n\n"));

	if (mode === "ask") {
		const confirmed = await deps.operator.ask({
			type: "confirm",
			question: "   Start it now?",
			default: true,
		});
		if (!confirmed) {
			console.error(chalk.dim("\n   Run `refarm doctor` for diagnostics."));
			return false;
		}
	}

	process.stdout.write(chalk.dim("   → Starting farmhand..."));
	deps.spawnFarmhand(repoRoot);

	const start = Date.now();
	const ready = await deps.probeFarmhandUntilReady();
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);

	if (ready) {
		process.stdout.write("  " + chalk.green("✓ Ready") + chalk.dim(` (${elapsed}s)`) + "\n\n");
		return true;
	}

	process.stdout.write("  " + chalk.red("✗ Timed out") + "\n");
	console.error(chalk.dim("   Run `refarm doctor` for diagnostics."));
	return false;
}

async function probeFarmhand(): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			FARMHAND_PROBE_TIMEOUT_MS,
		);
		const response = await fetch(`${SIDECAR_URL}/efforts/summary`, {
			signal: controller.signal,
		});
		clearTimeout(timer);
		return response.ok;
	} catch {
		return false;
	}
}

export function printSessionGuide(r: SessionReadiness): void {
	if (isFirstRun()) {
		printOnboarding();
		return;
	}

	if (!r.providerConfigured && !r.farmhandRunning) {
		console.error(chalk.red("✗  refarm is not configured yet.\n"));
		console.error(
			chalk.dim("   Configure your model provider:  ") + chalk.cyan("refarm sow"),
		);
		return;
	}

	if (!r.providerConfigured) {
		console.error(chalk.red("✗  No model provider configured.\n"));
		console.error(
			chalk.dim("   Set up a provider:  ") + chalk.cyan("refarm sow"),
		);
		console.error(
			chalk.dim("   Use Ollama:         ") +
				chalk.cyan("ollama serve") +
				chalk.dim("  (then refarm sow)"),
		);
		return;
	}

	if (!r.farmhandRunning) {
		console.error(chalk.red("✗  Farmhand is not running.\n"));
		console.error(
			chalk.dim("   Diagnose:  ") + chalk.cyan("refarm doctor"),
		);
	}
}

export function printOnboarding(): void {
	console.log(chalk.bold("Welcome to refarm.") + "\n");
	console.log(chalk.bold("To get started:\n"));
	console.log(
		"  " + chalk.cyan("1.") + "  Configure credentials:  " + chalk.cyan("refarm sow"),
	);
	console.log(
		"  " + chalk.cyan("2.") + "  Then run:               " + chalk.cyan("refarm"),
	);
	console.log(chalk.dim("\n  Farmhand starts automatically on first use."));
	console.log();
	console.log(chalk.dim("Need help?  ") + chalk.cyan("refarm doctor"));
}
```

- [ ] **Step 3: Update `session-launch.test.ts`**

Update imports and `makeLaunchDeps`. The key insight: each test that exercises `autoStartFarmhand` in `"ask"` mode calls `operator.ask()` exactly once. Tests in `"always"` or `"never"` mode never call `ask()`. Use `createScriptedOperatorChannel` with the right queue length per test.

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import {
	isSessionReady,
	isFirstRun,
	refarmSearchDirs,
	autoStartFarmhand,
	readAutostartMode,
	type LaunchDeps,
} from "./session-launch.js";

describe("isSessionReady", () => {
	it("returns true when both provider and farmhand are ready", () => {
		expect(
			isSessionReady({ providerConfigured: true, farmhandRunning: true }),
		).toBe(true);
	});

	it("returns false when farmhand is not running", () => {
		expect(
			isSessionReady({ providerConfigured: true, farmhandRunning: false }),
		).toBe(false);
	});

	it("returns false when provider is not configured", () => {
		expect(
			isSessionReady({ providerConfigured: false, farmhandRunning: true }),
		).toBe(false);
	});

	it("returns false when neither is ready", () => {
		expect(
			isSessionReady({ providerConfigured: false, farmhandRunning: false }),
		).toBe(false);
	});
});

describe("isFirstRun", () => {
	const originalHome = process.env.HOME;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/tmp/refarm-test-cwd-nonexistent");
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		cwdSpy.mockRestore();
	});

	it("returns true when neither home nor project-local .refarm exist", () => {
		expect(isFirstRun()).toBe(true);
	});

	it("returns false when project-local .refarm/config.json exists", () => {
		const tmpBase = join(tmpdir(), `refarm-test-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ provider: "anthropic" }));
		cwdSpy.mockReturnValue(tmpBase);

		try {
			expect(isFirstRun()).toBe(false);
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});
});

describe("refarmSearchDirs", () => {
	it("includes home dir and cwd-based dir", () => {
		const dirs = refarmSearchDirs();
		expect(dirs.some((d) => d.includes(".refarm"))).toBe(true);
		expect(dirs.length).toBeGreaterThanOrEqual(2);
	});
});

function makeLaunchDeps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
	return {
		operator: createScriptedOperatorChannel([true]),
		spawnFarmhand: vi.fn(),
		probeFarmhandUntilReady: vi.fn().mockResolvedValue(true),
		...overrides,
	};
}

describe("autoStartFarmhand — mode: ask (default)", () => {
	it("returns true when user confirms and farmhand becomes ready", async () => {
		const deps = makeLaunchDeps();
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(true);
		expect(deps.spawnFarmhand).toHaveBeenCalledWith("/fake/root");
	});

	it("returns false and does not spawn when user declines", async () => {
		const deps = makeLaunchDeps({ operator: createScriptedOperatorChannel([false]) });
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(false);
		expect(deps.spawnFarmhand).not.toHaveBeenCalled();
	});

	it("returns false when farmhand times out after spawning", async () => {
		const deps = makeLaunchDeps({
			probeFarmhandUntilReady: vi.fn().mockResolvedValue(false),
		});
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(false);
		expect(deps.spawnFarmhand).toHaveBeenCalledOnce();
	});

	it("passes the repo root to spawnFarmhand", async () => {
		const deps = makeLaunchDeps();
		await autoStartFarmhand("/my/repo", deps);
		expect(deps.spawnFarmhand).toHaveBeenCalledWith("/my/repo");
	});
});

describe("autoStartFarmhand — mode: always", () => {
	it("spawns without asking when autostartMode is always", async () => {
		const askSpy = vi.fn();
		const deps = makeLaunchDeps({
			autostartMode: "always",
			operator: { ask: askSpy },
		});
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(true);
		expect(askSpy).not.toHaveBeenCalled();
		expect(deps.spawnFarmhand).toHaveBeenCalledWith("/fake/root");
	});

	it("returns false when farmhand times out even in always mode", async () => {
		const askSpy = vi.fn();
		const deps = makeLaunchDeps({
			autostartMode: "always",
			operator: { ask: askSpy },
			probeFarmhandUntilReady: vi.fn().mockResolvedValue(false),
		});
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(false);
		expect(askSpy).not.toHaveBeenCalled();
		expect(deps.spawnFarmhand).toHaveBeenCalledOnce();
	});
});

describe("autoStartFarmhand — mode: never", () => {
	it("returns false immediately without asking or spawning", async () => {
		const askSpy = vi.fn();
		const deps = makeLaunchDeps({
			autostartMode: "never",
			operator: { ask: askSpy },
		});
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(false);
		expect(askSpy).not.toHaveBeenCalled();
		expect(deps.spawnFarmhand).not.toHaveBeenCalled();
	});
});

describe("readAutostartMode", () => {
	const originalHome = process.env.HOME;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/tmp/refarm-test-cwd-nonexistent");
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		cwdSpy.mockRestore();
	});

	it("returns 'ask' when no config file exists", () => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		expect(readAutostartMode()).toBe("ask");
	});

	it("returns 'always' when config.autostart is always", () => {
		const tmpBase = join(tmpdir(), `refarm-autostart-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ autostart: "always" }));
		cwdSpy.mockReturnValue(tmpBase);

		try {
			expect(readAutostartMode()).toBe("always");
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});

	it("returns 'never' when config.autostart is never", () => {
		const tmpBase = join(tmpdir(), `refarm-autostart-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ autostart: "never" }));
		cwdSpy.mockReturnValue(tmpBase);

		try {
			expect(readAutostartMode()).toBe("never");
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});

	it("returns 'ask' when config.autostart has an unrecognized value", () => {
		const tmpBase = join(tmpdir(), `refarm-autostart-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ autostart: "maybe" }));
		cwdSpy.mockReturnValue(tmpBase);

		try {
			expect(readAutostartMode()).toBe("ask");
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 4: Run all refarm tests to confirm nothing is broken**

```bash
cd /workspaces/refarm/apps/refarm && pnpm exec vitest run src/commands/session-launch.test.ts --reporter=verbose 2>&1
```

Expected: all 18 tests pass (names and count unchanged — only internals changed).

Also run the full type-check:
```bash
pnpm exec tsc --noEmit 2>&1
```

Expected: no output (zero errors).

- [ ] **Step 5: Commit**

```bash
git add apps/refarm/package.json apps/refarm/src/commands/session-launch.ts apps/refarm/src/commands/session-launch.test.ts pnpm-lock.yaml
git commit -m "feat(refarm): wire OperatorChannel into LaunchDeps, replace confirm() primitive"
```
