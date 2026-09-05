# The node comes back by itself — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tractor daemon is supervised by systemd, started through a command that re-derives its arguments and environment at every start, and `refarm runtime stop | restart` stop fighting the supervisor.

**Architecture:** A new `refarm runtime start --foreground` becomes the unit's `ExecStart`, so the unit stores the CALL and never the derived argv. It resolves engine, `runtimeNodeArgs()` and `runtimeNodeEnv()` exactly as the existing deliberate start paths do, runs the child in the foreground, forwards the stop signal, and exits with the child's code. `runtime stop | restart` consult the `supervised` fact the process contract already emits and hand over the systemctl line instead of sending SIGTERM behind the supervisor's back.

**Tech Stack:** TypeScript (`apps/refarm`, `packages/runtime-operator`), vitest, systemd user units.

**Spec:** `docs/superpowers/specs/2026-08-27-the-node-comes-back-by-itself-design.md`

## Global Constraints

- **A unit file stores the CALL that derives its arguments, never the derived arguments.** No task may write a resolved argv, plugin list or environment into a unit, a script or a config field.
- **refarm proposes systemctl lines; it never runs `systemctl enable | start | stop`.** Stated in `apps/refarm/src/commands/process.ts`: "refarm does the part that can be shown, reviewed and undone, and does not reach into a running session on the operator's behalf."
- **No guard lands until it has been SHOWN to fail** (CLAUDE.md section 9). Break the thing it watches, confirm the failure names the right thing, restore, and say so in the commit.
- **COMMIT BEFORE PROVING A GUARD.** Proving means mutating tracked files; `git checkout <file>` on uncommitted work destroys it. Commit the task's work first, then mutate, then `git checkout` to restore.
- **Node cannot replace its own process image.** There is no `execve` binding, so the foreground start is a real parent process and signal forwarding is mandatory, not optional.
- **Scoped commands only.** `pnpm --filter @refarm.dev/<pkg> run test | type-check | build`. Never a bare `cargo test` (CLAUDE.md section 7). No Rust changes are expected in this plan.
- **The installed tree is not the checkout.** Anything proven on the live node requires `refarm node install` first; a fix to a command is not observable on the node until it is installed.

---

### Task 1: The autostart spawn carries the node environment

Closes ISS-177. The spec's D1 note says the order is: fix the environment, then supervise.

**Files:**
- Modify: `packages/runtime-operator/src/autostart.ts` (the `spawnRuntime` contract at line 68, its call at line 139)
- Modify: `apps/refarm/src/commands/session-launch.ts:410-413` (`defaultLaunchDeps().spawnRuntime`)
- Test: `apps/refarm/src/commands/session-launch.test.ts` (create if absent)

**Interfaces:**
- Consumes: `runtimeNodeEnv(deps?: RuntimeNodeEnvDeps): Promise<NodeJS.ProcessEnv>` from `./runtime-node-env.js`; `startRuntimeProcess(command: RuntimeLaunchCommand, env?: NodeJS.ProcessEnv): RuntimeProcess`.
- Produces: `AutoStartRuntimeDeps.spawnRuntime(repoRoot: string): void | Promise<void>` — later tasks rely on the widened return type.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

describe("defaultLaunchDeps().spawnRuntime", () => {
  it("hands the runtime the node environment, not this process's", async () => {
    const startRuntime = vi.fn();
    const deps = defaultLaunchDeps({
      startRuntime,
      runtimeNodeEnv: async () => ({ ...process.env, MODEL_AUTHORIZATION_PROBE: "yes" }),
    });
    await deps.spawnRuntime("/nonexistent-repo-root");
    expect(startRuntime).toHaveBeenCalledTimes(1);
    const env = startRuntime.mock.calls[0]![1];
    expect(env).toBeDefined();
    expect(env.MODEL_AUTHORIZATION_PROBE).toBe("yes");
  });
});
```

`defaultLaunchDeps` currently takes no arguments. Give it an optional injection bag
(`{ startRuntime?, runtimeNodeEnv? }`) defaulting to the real functions — the same shape
`runtime.ts` already uses with `deps.startRuntime ?? startRuntimeProcess`. Do not reach for a
module mock; the injection point is the pattern this codebase already uses.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @refarm.dev/refarm run test -- session-launch`
Expected: FAIL — `env` is `undefined`, because `startRuntimeProcess(command)` is called with one argument.

- [ ] **Step 3: Widen the contract**

In `packages/runtime-operator/src/autostart.ts`:

```ts
	/** Start the daemon (the app wires its spawn). May be async: an app that must assemble
	 *  the node's environment before spawning has to await it, and a runtime started without
	 *  that environment comes up ready and refuses every dispatch (ISS-177). */
	spawnRuntime(repoRoot: string): void | Promise<void>;
```

and at its call site:

```ts
		await deps.spawnRuntime(repoRoot);
```

`await` on a `void` is a no-op, so every existing synchronous implementation keeps working.

- [ ] **Step 4: Carry the environment**

In `apps/refarm/src/commands/session-launch.ts`:

```ts
		async spawnRuntime(repoRoot) {
			const runtime = resolveLaunchRuntime(repoRoot);
			const command = resolveRuntimeLaunchCommand(repoRoot, runtime.activeEngine, runtimeNodeArgs(resolveRefarmHome()));
			// THE ENVIRONMENT, not only the arguments. Measured 2026-08-19 and recorded in
			// runtime-node-env.ts: a runtime started with arguments alone comes up healthy and
			// refuses every dispatch, which is worse than one that does not start because
			// `status` says ready.
			(deps.startRuntime ?? startRuntimeProcess)(command, await (deps.runtimeNodeEnv ?? runtimeNodeEnv)());
		},
```

- [ ] **Step 5: Run the test and the package suite**

Run: `pnpm --filter @refarm.dev/refarm run test -- session-launch`
Expected: PASS
Run: `pnpm --filter @refarm.dev/runtime-operator run test`
Expected: PASS — the widened contract must not break the machine's own suite.

- [ ] **Step 6: Commit, then PROVE the guard**

```bash
git add -A && git commit -m "fix(runtime): autostart hands the daemon the node's environment, not only its arguments"
```

Then delete the `await (deps.runtimeNodeEnv ?? runtimeNodeEnv)()` argument, re-run the test, and
confirm it goes red on the SECOND PARAMETER of the spy — not on a downstream symptom. Restore with
`git checkout apps/refarm/src/commands/session-launch.ts`. Amend the commit message to record that
the guard was proven and what turned it red.

---

### Task 2: `refarm runtime start --foreground`

**Files:**
- Create: `apps/refarm/src/commands/runtime-foreground.ts`
- Create: `apps/refarm/src/commands/runtime-foreground.test.ts`
- Modify: `apps/refarm/src/commands/runtime.ts` (the `start` subcommand, near line 79 for the option and the existing start handler)

**Interfaces:**
- Consumes: `resolveRuntimeLaunchCommand(repoRoot, engine, nodeArgs?)`, `runtimeNodeArgs(refarmHome)`, `runtimeNodeEnv()`, `resolveRefarmHome()`.
- Produces:
  ```ts
  export interface ForegroundRuntimeDeps {
    readonly spawn?: typeof import("node:child_process").spawn;
    readonly resolveHome?: () => string;
    readonly nodeEnv?: () => Promise<NodeJS.ProcessEnv>;
    readonly onSignal?: (handler: (signal: NodeJS.Signals) => void) => void;
  }
  export interface ForegroundRuntimeResult {
    readonly command: string;
    readonly args: readonly string[];
    readonly exitCode: number;
  }
  export async function runRuntimeForeground(
    repoRoot: string,
    engine: LaunchRuntimeEngine,
    deps?: ForegroundRuntimeDeps,
  ): Promise<ForegroundRuntimeResult>;
  ```
  Task 3 adds signal forwarding to this same function and uses `onSignal`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { runRuntimeForeground } from "./runtime-foreground.js";

function fakeChild() {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  return {
    kill: vi.fn(),
    on(event: string, fn: (...a: unknown[]) => void) {
      (handlers[event] ??= []).push(fn);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers[event] ?? []) fn(...args);
    },
  };
}

describe("runRuntimeForeground", () => {
  it("derives the plugin arguments at call time rather than taking a frozen list", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit("exit", 0, null));
      return child as never;
    });
    const result = await runRuntimeForeground("/repo", "rust", {
      spawn: spawn as never,
      resolveHome: () => "/fixture-home-with-two-plugins",
      nodeEnv: async () => ({ PROBE: "1" }),
    });
    expect(result.exitCode).toBe(0);
    const args = spawn.mock.calls[0]![1] as string[];
    expect(args.filter((a) => a === "--plugin")).toHaveLength(2);
    expect(args).toContain("--refarm-dir");
  });

  it("hands the child the node environment", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit("exit", 0, null));
      return child as never;
    });
    await runRuntimeForeground("/repo", "rust", {
      spawn: spawn as never,
      resolveHome: () => "/fixture-home-with-two-plugins",
      nodeEnv: async () => ({ MODEL_AUTHORIZATION_PROBE: "yes" }),
    });
    const options = spawn.mock.calls[0]![2] as { env: NodeJS.ProcessEnv; stdio: string };
    expect(options.env.MODEL_AUTHORIZATION_PROBE).toBe("yes");
    expect(options.stdio).toBe("inherit");
  });

  it("exits with the child's code", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit("exit", 3, null));
      return child as never;
    });
    const result = await runRuntimeForeground("/repo", "rust", {
      spawn: spawn as never,
      resolveHome: () => "/fixture-home-with-two-plugins",
      nodeEnv: async () => ({}),
    });
    expect(result.exitCode).toBe(3);
  });
});
```

The first test needs a real fixture home with two installed plugin directories, because
`runtimeNodeArgs` reads the filesystem (`existsSync` on the agent's wasm, then
`resolveBootPluginPaths`). Build it with a temp directory in `beforeAll` mirroring
`~/.refarm/plugins/refarm_<name>/plugin.wasm` and a minimal `config.json` — production-shaped
paths, never `plugin.wasm` renamed to the plugin id, because a stem that happens to equal the id
hides exactly the class of defect this repo keeps finding.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @refarm.dev/refarm run test -- runtime-foreground`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

```ts
import { spawn as nodeSpawn } from "node:child_process";

import type { LaunchRuntimeEngine } from "@refarm.dev/runtime-operator";

import { resolveRefarmHome } from "../utils/refarm-home.js";
import { resolveRuntimeLaunchCommand } from "./runtime-launcher.js";
import { runtimeNodeArgs } from "./runtime-node-args.js";
import { runtimeNodeEnv } from "./runtime-node-env.js";

/**
 * Run the node's runtime IN THE FOREGROUND, deriving everything it needs at call time.
 *
 * This is what a supervisor's `ExecStart` points at. A unit that carried the resolved argv
 * would freeze the plugin set at the moment it was written -- install a third plugin and the
 * node that returns from a reboot loads two, while `plugin status` reports honestly about a
 * daemon running something else. The unit stores the CALL; the derivation happens here.
 */
export async function runRuntimeForeground(
  repoRoot: string,
  engine: LaunchRuntimeEngine,
  deps: ForegroundRuntimeDeps = {},
): Promise<ForegroundRuntimeResult> {
  const home = (deps.resolveHome ?? resolveRefarmHome)();
  const launch = resolveRuntimeLaunchCommand(repoRoot, engine, runtimeNodeArgs(home));
  const env = await (deps.nodeEnv ?? runtimeNodeEnv)();
  const spawnFn = deps.spawn ?? nodeSpawn;
  const child = spawnFn(launch.command, [...launch.args], { stdio: "inherit", env });
  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code: number | null) => resolve(code ?? 0));
  });
  return { command: launch.command, args: launch.args, exitCode };
}
```

- [ ] **Step 4: Wire the flag**

In `apps/refarm/src/commands/runtime.ts`, add to the `start` subcommand:

```ts
				.option(
					"--foreground",
					"Run the runtime in this process instead of detaching — what a supervisor's ExecStart uses",
				)
```

and, at the top of the start handler, before any detached-start path:

```ts
					if (opts.foreground) {
						const result = await runRuntimeForeground(repoRoot, selection.activeEngine);
						process.exitCode = result.exitCode;
						return;
					}
```

`--foreground` and `--json` are mutually exclusive in practice: the foreground process IS the
daemon and prints the daemon's own output. Refuse the combination with the same shape the other
refusals use rather than printing a payload nobody will read.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @refarm.dev/refarm run test -- runtime-foreground`
Expected: PASS
Run: `pnpm --filter @refarm.dev/refarm run type-check`
Expected: PASS

- [ ] **Step 6: Commit, then PROVE the guard**

```bash
git add -A && git commit -m "feat(runtime): a foreground start that derives its arguments and environment at every start"
```

Then replace `runtimeNodeArgs(home)` with a frozen literal (`["--plugin", "/a", "--refarm-dir", home]`),
re-run, and confirm the first test goes red naming the missing second `--plugin`. Restore with
`git checkout`. Amend the commit to record the mutation.

---

### Task 3: The foreground start forwards the stop signal

**Files:**
- Modify: `apps/refarm/src/commands/runtime-foreground.ts`
- Modify: `apps/refarm/src/commands/runtime-foreground.test.ts`

**Interfaces:**
- Consumes: `ForegroundRuntimeDeps.onSignal` from Task 2.
- Produces: nothing new — the same `runRuntimeForeground` signature.

**Why this is its own task:** the generated unit template sets `KillMode=mixed`, which sends
SIGTERM to the MAIN process only. With a wrapper, the main process is Node, not tractor. Without
forwarding, `TimeoutStopSec` elapses and systemd SIGKILLs the group — turning the graceful drain
`packages/tractor/src/daemon/shutdown.rs` was written to provide back into the hard kill it was
written to end.

- [ ] **Step 1: Write the failing test**

```ts
  it("forwards SIGTERM to the child and waits for it", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child as never);
    let raise: ((signal: NodeJS.Signals) => void) | undefined;
    const pending = runRuntimeForeground("/repo", "rust", {
      spawn: spawn as never,
      resolveHome: () => "/fixture-home-with-two-plugins",
      nodeEnv: async () => ({}),
      onSignal: (handler) => {
        raise = handler;
      },
    });
    await vi.waitFor(() => expect(raise).toBeDefined());
    raise!("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", 0, "SIGTERM");
    await expect(pending).resolves.toMatchObject({ exitCode: 0 });
  });
```

The assertion that matters is `child.kill` — that the SIGNAL REACHED THE CHILD. Asserting only
that the wrapper exited would pass against a wrapper that exits and abandons the daemon, which is
the defect.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @refarm.dev/refarm run test -- runtime-foreground`
Expected: FAIL — `child.kill` was never called; `raise` is `undefined` because nothing registers a handler.

- [ ] **Step 3: Implement the forwarder**

```ts
const STOP_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

  // FORWARDED, not swallowed. The wrapper is the unit's MainPID under KillMode=mixed, so the
  // supervisor's SIGTERM arrives HERE. The daemon already treats SIGTERM exactly like SIGINT and
  // drains on it; a wrapper that exits without passing it on turns that drain into a SIGKILL
  // twenty seconds later.
  const register = deps.onSignal ?? ((handler) => {
    for (const signal of STOP_SIGNALS) process.on(signal, () => handler(signal));
  });
  register((signal) => {
    child.kill(signal);
  });
```

placed immediately after the child is spawned and before the exit promise is awaited.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @refarm.dev/refarm run test -- runtime-foreground`
Expected: PASS, all four tests.

- [ ] **Step 5: Commit, then PROVE the guard**

```bash
git add -A && git commit -m "fix(runtime): the foreground start forwards the supervisor's stop signal to the daemon"
```

Then delete the `register(...)` block, re-run, and confirm the test goes red on `child.kill` never
having been called. Restore with `git checkout`. Amend the commit to record it.

---

### Task 4: `runtime stop` and `runtime restart` refuse under supervision

**Files:**
- Create: `apps/refarm/src/commands/runtime-supervision.ts`
- Create: `apps/refarm/src/commands/runtime-supervision.test.ts`
- Modify: `apps/refarm/src/commands/runtime.ts` (the `stop` and `restart` handlers)

**Interfaces:**
- Consumes: `runProcessStatus` from `./process.js` (exported at `process.ts:325`), which returns statuses carrying `{ name, state, detail, backend, supervised }` per `packages/process-contract-v1/src/index.ts:447`.
- Produces:
  ```ts
  export const SUPERVISED_RUNTIME_PROCESS = "runtime";
  export interface RuntimeSupervision {
    readonly supervised: boolean;
    readonly unit: string;
    readonly stopCommand: string;
    readonly restartCommand: string;
  }
  export async function readRuntimeSupervision(
    deps?: { readonly readStatuses?: () => Promise<readonly ProcessStatus[]> },
  ): Promise<RuntimeSupervision>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("readRuntimeSupervision", () => {
  it("reports supervised with the exact systemctl lines when the process is declared and up", async () => {
    const result = await readRuntimeSupervision({
      readStatuses: async () => [
        { name: "runtime", state: "running", detail: "", backend: "systemd-user", supervised: true },
      ],
    });
    expect(result.supervised).toBe(true);
    expect(result.stopCommand).toBe("systemctl --user stop refarm-runtime.service");
    expect(result.restartCommand).toBe("systemctl --user restart refarm-runtime.service");
  });

  it("reports unsupervised when no runtime process is declared", async () => {
    const result = await readRuntimeSupervision({
      readStatuses: async () => [
        { name: "web-serve", state: "running", detail: "", backend: "systemd-user", supervised: true },
      ],
    });
    expect(result.supervised).toBe(false);
  });

  it("treats could-not-ask as UNSUPERVISED, never as supervised", async () => {
    const result = await readRuntimeSupervision({
      readStatuses: async () => [
        { name: "runtime", state: "could-not-ask", detail: "", backend: "systemd-user", supervised: null },
      ],
    });
    expect(result.supervised).toBe(false);
  });
});

describe("runtime stop", () => {
  it("refuses under supervision and does not send a signal", async () => {
    const stopRuntime = vi.fn();
    const result = await runRuntimeStop({
      stopRuntime,
      supervision: async () => ({
        supervised: true,
        unit: "refarm-runtime.service",
        stopCommand: "systemctl --user stop refarm-runtime.service",
        restartCommand: "systemctl --user restart refarm-runtime.service",
      }),
    });
    expect(stopRuntime).not.toHaveBeenCalled();
    expect(result.nextCommand).toBe("systemctl --user stop refarm-runtime.service");
  });
});
```

The third test is the one that matters most: `supervised: null` means "could not ask systemd". A
`null` read as supervised would refuse to stop a daemon nobody is supervising, leaving the
operator with no way to stop it at all. Fail OPEN on an unknown, which is the opposite of the
integrity default — because here the risk of a wrong refusal is worse than a wrong stop.

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @refarm.dev/refarm run test -- runtime-supervision`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the reader**

```ts
export const SUPERVISED_RUNTIME_PROCESS = "runtime";

const unitName = (name: string) => `refarm-${name}.service`;

/**
 * Is this node's daemon under a supervisor, and what stops it if so?
 *
 * NEVER GUESSES SUPERVISED. `supervised: null` is "could not ask systemd", and reading that as
 * supervised would refuse the only stop the operator has left. An unknown answers "no".
 */
export async function readRuntimeSupervision(deps: {...} = {}): Promise<RuntimeSupervision> {
  const unit = unitName(SUPERVISED_RUNTIME_PROCESS);
  const base = {
    unit,
    stopCommand: `systemctl --user stop ${unit}`,
    restartCommand: `systemctl --user restart ${unit}`,
  };
  try {
    const statuses = await (deps.readStatuses ?? defaultReadStatuses)();
    const row = statuses.find((s) => s.name === SUPERVISED_RUNTIME_PROCESS);
    return { ...base, supervised: row?.supervised === true };
  } catch {
    // A reader that throws is an unknown, and an unknown is not supervision.
    return { ...base, supervised: false };
  }
}
```

- [ ] **Step 4: Refuse in the handlers**

In `runtime.ts`, at the top of both the `stop` and `restart` handlers, before any call to
`stopRuntimeProcess`:

```ts
					const supervision = await (deps.supervision ?? readRuntimeSupervision)();
					if (supervision.supervised) {
						// REFUSED, not silently redirected. Sending SIGTERM by pid under Restart=always
						// reads to the supervisor as a crash and the daemon returns in five seconds --
						// the operator's intent defeated without a word. refarm does not run systemctl
						// on their behalf (process.ts), so it hands over the line that does.
						const command = opts.restart ? supervision.restartCommand : supervision.stopCommand;
						printSupervisedRefusal(supervision, command, json);
						process.exitCode = 1;
						return;
					}
```

Use the JSON envelope shape the rest of `runtime.ts` uses, with `nextCommand` and `nextCommands`
carrying the systemctl line — the handoff must route to the action that finishes the work, which
is the defect ISS-173 records elsewhere in this repo.

- [ ] **Step 5: Run the tests and the package suite**

Run: `pnpm --filter @refarm.dev/refarm run test -- runtime-supervision`
Expected: PASS
Run: `pnpm --filter @refarm.dev/refarm run test`
Expected: PASS — `runtime.test.ts` covers stop and restart today and must keep passing on the unsupervised path.

- [ ] **Step 6: Commit, then PROVE the guard**

```bash
git add -A && git commit -m "fix(runtime): stop and restart refuse under supervision and hand over the systemctl line"
```

Then change the branch to `if (false)` and re-run: the refusal test must go red ON THE SPY
(`stopRuntime` was called), not only on the message. Restore, then separately change
`row?.supervised === true` to `row?.supervised !== false` and confirm the `could-not-ask` test goes
red. Restore with `git checkout`. Amend the commit to record both mutations.

---

### Task 5: Declare, install and prove it on this node

This task produces no source change. It produces a MEASUREMENT, and the numbers it writes into the
ledger are the ones it observed.

**Files:**
- Modify: `.project/issues.json` (ISS-172 resolution)
- Modify: `docs/superpowers/specs/2026-08-27-the-node-comes-back-by-itself-design.md` if the measured `TimeoutStopSec` differs from the template's 20s

- [ ] **Step 1: Install the tree that carries the change**

```bash
pnpm --filter @refarm.dev/refarm run build
refarm node install --verify-only
refarm node install
```

The node runs an installed tree, not the checkout. Without this the unit's `ExecStart` would call
a `refarm` that has no `--foreground`.

- [ ] **Step 2: Declare the process**

```bash
refarm process add runtime \
  --description "the tractor daemon that IS this node's control plane" \
  --command "/home/s095407044/.local/bin/refarm runtime start --foreground" \
  --working-directory /home/s095407044 \
  --restart always \
  --attended-elsewhere --json
```

`process add` files a consent question rather than writing. Answer it with
`refarm resume --answer declare:processes:runtime --authorize` after reading the diff it carries.
`--working-directory` is the operator's home deliberately: unlike the automation tick, the daemon
reads `--refarm-dir` from a derived absolute path and depends on no cwd.

- [ ] **Step 3: Install the unit and read it before authorising**

```bash
refarm process install runtime --attended-elsewhere --json
```

Read the proposed unit from the standing question, then authorise it. Confirm `ExecStart` names
`runtime start --foreground` and NOT a resolved `tractor --plugin ...` line — that check is the
whole of F1.

- [ ] **Step 4: MEASURE the drain, do not inherit the number**

With the daemon running under the unit:

```bash
systemctl --user show refarm-runtime.service -p MainPID --value
time systemctl --user stop refarm-runtime.service
journalctl --user -u refarm-runtime.service -n 30 --no-pager
```

The measured stop duration decides whether `TimeoutStopSec=20` fits. If the drain exceeds it, the
number changes and the spec records the measurement beside it. A number inherited from a template
written for processes that drain nothing is not evidence.

- [ ] **Step 5: Prove the two properties that matter**

```bash
# operator intent is honoured
systemctl --user stop refarm-runtime.service
systemctl --user is-active refarm-runtime.service   # expect: inactive, and STAYS inactive
refarm runtime stop                                  # expect: the refusal from Task 4

# a crash is healed
systemctl --user start refarm-runtime.service
kill -9 "$(systemctl --user show refarm-runtime.service -p MainPID --value)"
systemctl --user show refarm-runtime.service -p NRestarts --value  # expect: 1, and ready again
```

- [ ] **Step 6: Prove the derivation is live**

Install or remove one plugin, restart the unit, and confirm `refarm plugin status` and the running
process agree on the plugin set. This is the property a frozen argv would have broken, and it is
the only one that cannot be proven by a unit test.

- [ ] **Step 7: Resolve the item against the commit that proved it**

```bash
git add -A && git commit -m "feat(node): the daemon is supervised, and the unit stores the call rather than the argv"
refarm issues set-status --workspace refarm --id ISS-172 --status resolved --resolved-by <commit>
```

Record in the body: the measured stop duration, the `NRestarts` observed, and the plugin-set check
from Step 6. Every number measured, none inherited.

---

## Notes for the executor

- ISS-177 (Task 1) is a live defect on the operator's daily driver and lands first for that reason,
  not only because the spec orders it that way.
- Tasks 2 and 3 touch one file and could be one commit; they are separate because signal forwarding
  is worth its own reviewer gate and its own proven guard.
- Task 4's `could-not-ask` case is the subtle one. Get it wrong in the safe-looking direction
  (treating unknown as supervised) and the operator loses the ability to stop their own daemon.
- Nothing in this plan runs `systemctl enable | start | stop` from inside refarm. Task 5 runs them
  as the OPERATOR, at a terminal, which is a different thing and the boundary the codebase draws.
