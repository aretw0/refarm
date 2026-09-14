# Connection Operator Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator ask "is my declared connection actually up?" and get the truth — `refarm connection status`, plus a doctor finding when a declared connection's binary is missing.

**Architecture:** Pure TypeScript in `apps/refarm`, mirroring where `refarm workspace run` lives (`apps/refarm/src/commands/workspace.ts`) because this is the same shape: an operator command over a declared catalog. It needs **no plugin, no WASM, and no populated host registry** — the probe asks the system directly, so the CLI can report live truth today.

**Tech Stack:** TypeScript, `@refarm.dev/config` (`loadConfig`), `node:child_process`, vitest.

Design spec: [`docs/superpowers/specs/2026-07-28-declared-connections-shared-sessions-design.md`](../specs/2026-07-28-declared-connections-shared-sessions-design.md) — decisions D1b (readiness is a probe), D12 (the operator is shown reality), D13 (an attempt that needs a human must first acquire the human).

**Why this before exposing the engine to plugins:** the operator's VPN died silently while they were away from their phone, and they had no way to ask whether it was up. The engine already knows how to answer; nothing surfaces the answer.

## Global Constraints

- Source only; never edit generated artifacts.
- Scoped commands: `pnpm --filter @refarm.dev/refarm run type-check`, and vitest per file from `apps/refarm`.
- Do NOT touch `packages/plugin-manifest/**`, `.github/workflows/**`, `.project/**`, or anything under `packages/tractor/**`. This plan is TypeScript only.
- Do NOT add a WIT interface or a `Permission` variant — that is a separate, operator-gated plan.
- **The probe is structured argv, never a shell.** Reject shell-like binaries by basename, exactly as the Rust parser does (`sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`, `env`, `eval`, `command`), and reject a `probe.shell` key pointing at design D1c.
- **Never print a secret.** A connection declaration carries argv and patterns, not credentials, but the report must not echo environment values.
- Commit messages end with the two trailer lines used throughout this repo (copy from `git log -1 --format=%B`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/refarm/src/commands/connection-catalog.ts` | read + normalise the declared `connections` block; resolve binaries |
| `apps/refarm/src/commands/connection.ts` | the `refarm connection status` command and its JSON envelope |
| `apps/refarm/src/program.ts` | register the command |
| `apps/refarm/test/commands/connection-catalog.test.ts` | catalog + binary-resolution tests |
| `apps/refarm/test/commands/connection-status.test.ts` | probe-running and envelope tests |

Precedent to follow for the command's shape and JSON envelope: `apps/refarm/src/commands/workspace.ts` (`buildJsonSuccessEnvelope` / `buildJsonErrorEnvelope` / `printJson` from `@refarm.dev/capabilities/envelope`).

---

### Task 1: Read the declared catalog and resolve its binaries

**Files:**
- Create: `apps/refarm/src/commands/connection-catalog.ts`
- Test: `apps/refarm/test/commands/connection-catalog.test.ts`

**Interfaces produced:**
- `export interface ConnectionProbe { run: string[]; expect?: string }`
- `export interface DeclaredConnection { name: string; establish: string[]; probe: ConnectionProbe; env: Record<string, string>; cwd?: string; readyTimeoutMs: number; probeIntervalMs: number; linger: "operator" | { idleMs: number } }`
- `export interface CatalogIssue { connection: string; field: string; message: string }`
- `export function readConnectionCatalog(config: Record<string, unknown>): { connections: DeclaredConnection[]; issues: CatalogIssue[] }`
- `export function resolveBinary(argv0: string, env?: NodeJS.ProcessEnv): string | null`

`readConnectionCatalog` is **pure over a config object** — the caller supplies it via `loadConfig()`, so every test drives it with a literal and never touches the filesystem.

**A deliberate difference from the Rust parser:** the host FAILS SHUT on a malformed declaration, because it is about to run it. This surface REPORTS instead — a bad declaration must appear in `issues` and still be listed, because an operator debugging a broken connection needs to see it, not have the whole command refuse. Never silently drop one.

- [ ] **Step 1: Write the failing tests**

Create `apps/refarm/test/commands/connection-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
	readConnectionCatalog,
	resolveBinary,
} from "../../src/commands/connection-catalog.js";

const VPN = {
	connections: {
		"serpro-vpn": {
			establish: ["serpro-vpn", "connect"],
			probe: { run: ["ip", "-br", "link", "show", "ovpntun0"], expect: "UP" },
		},
	},
};

describe("reading the declared connection catalog", () => {
	it("reads a declaration and fills the documented defaults", () => {
		const { connections, issues } = readConnectionCatalog(VPN);
		expect(issues).toEqual([]);
		expect(connections).toHaveLength(1);
		const vpn = connections[0]!;
		expect(vpn.name).toBe("serpro-vpn");
		expect(vpn.establish).toEqual(["serpro-vpn", "connect"]);
		expect(vpn.probe.run[0]).toBe("ip");
		expect(vpn.probe.expect).toBe("UP");
		expect(vpn.readyTimeoutMs).toBe(120_000);
		expect(vpn.probeIntervalMs).toBe(1_000);
		expect(vpn.linger).toBe("operator");
	});

	it("returns an empty catalog when nothing is declared", () => {
		expect(readConnectionCatalog({})).toEqual({ connections: [], issues: [] });
	});

	it("reports a malformed declaration instead of dropping it", () => {
		// The host fails shut because it is about to RUN this. The operator surface
		// must still show the connection, or debugging it is impossible.
		const { connections, issues } = readConnectionCatalog({
			connections: { broken: { establish: [], probe: { run: ["true"] } } },
		});
		expect(connections.map((c) => c.name)).toContain("broken");
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "broken", field: "establish" }),
		);
	});

	it("reports a missing probe, because readiness is the probe", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { establish: ["bin"] } },
		});
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "probe" }));
	});

	it("reports a shell-like probe binary by basename", () => {
		for (const shell of ["sh", "/bin/sh", "bash", "env"]) {
			const { issues } = readConnectionCatalog({
				connections: { c: { establish: ["bin"], probe: { run: [shell, "-c", "x | y"] } } },
			});
			expect(
				issues.some((i) => i.connection === "c" && /shell/i.test(i.message)),
				`expected a shell issue for ${shell}`,
			).toBe(true);
		}
	});

	it("reports a probe.shell key as needing an operator grant", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { establish: ["bin"], probe: { run: ["true"], shell: "a | b" } } },
		});
		expect(issues.some((i) => /grant/i.test(i.message))).toBe(true);
	});

	it("reports a non-zero idle linger as not implemented", () => {
		const { issues } = readConnectionCatalog({
			connections: {
				c: { establish: ["bin"], probe: { run: ["true"] }, linger: { idleMs: 60_000 } },
			},
		});
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "linger" }));
	});
});

describe("resolving a declared binary", () => {
	it("resolves an absolute path that exists", () => {
		expect(resolveBinary("/usr/bin/true")).toBe("/usr/bin/true");
	});

	it("returns null for an absolute path that does not exist", () => {
		expect(resolveBinary("/usr/bin/definitely-not-here-xyz")).toBeNull();
	});

	it("finds a bare name on PATH", () => {
		expect(resolveBinary("true", { PATH: "/usr/bin:/bin" } as NodeJS.ProcessEnv)).toBe(
			"/usr/bin/true",
		);
	});

	it("returns null for a bare name that is not on PATH", () => {
		expect(resolveBinary("definitely-not-here-xyz", { PATH: "/usr/bin" } as NodeJS.ProcessEnv))
			.toBeNull();
	});

	it("returns null rather than throwing when PATH is unset", () => {
		expect(resolveBinary("true", {} as NodeJS.ProcessEnv)).toBeNull();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

From `apps/refarm`: `npx vitest run test/commands/connection-catalog.test.ts --maxWorkers=1`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/refarm/src/commands/connection-catalog.ts`. Mirror the Rust parser's rules
(`packages/tractor/src/host/host_effects_bridge/connection_decl.rs`) for what counts as valid, but
REPORT rather than throw. Defaults to match it exactly: `readyTimeoutMs` 120000, `probeIntervalMs`
1000, `linger` `"operator"`. Shell-like basenames to reject: `sh`, `bash`, `zsh`, `dash`, `ksh`,
`fish`, `env`, `eval`, `command`. `resolveBinary` handles an absolute/relative path (exists +
executable) and a bare name searched across `PATH`, returning `null` instead of throwing on any
error.

- [ ] **Step 4: Run the tests to verify they pass**

Expected: PASS, 12 tests.

- [ ] **Step 5: Type-check and commit**

`pnpm --filter @refarm.dev/refarm run type-check`, then commit both files.

---

### Task 2: `refarm connection status`

**Files:**
- Create: `apps/refarm/src/commands/connection.ts`
- Modify: `apps/refarm/src/program.ts`
- Test: `apps/refarm/test/commands/connection-status.test.ts`

**Interfaces produced:**
- `export interface ConnectionReport { name: string; establish: string[]; establishBinary: string | null; probeBinary: string | null; state: "up" | "down" | "unknown"; detail?: string; issues: CatalogIssue[] }`
- `export async function reportConnections(deps: { config: Record<string, unknown>; runProbe: (c: DeclaredConnection) => Promise<{ ok: boolean; detail?: string }> }): Promise<ConnectionReport[]>`
- `export function runProbeProcess(connection: DeclaredConnection, timeoutMs?: number): Promise<{ ok: boolean; detail?: string }>`
- `export const connectionCommand: Command`

`reportConnections` takes the probe runner **injected**, so every test is hermetic; `runProbeProcess`
is the real adapter, exercised separately against `/usr/bin/true` and `/usr/bin/false`.

**States:** `up` when the probe succeeds; `down` when it runs and fails; `unknown` when the probe
could not run at all (binary missing, or the declaration has issues that make it unrunnable) — never
conflate "I asked and it said no" with "I could not ask", because the operator's next action differs.

- [ ] **Step 1: Write the failing tests**

Cover, with an injected probe runner: an `up` connection; a `down` one; `unknown` when the probe
binary does not resolve; that a declaration with issues is still listed with its issues attached;
that the JSON envelope carries `ok`, `command: "connection"`, `operation: "status"` and a
`connections` array; and that a connection whose establish binary is missing is reported (not
omitted). Then, against real binaries: `runProbeProcess` returns `ok: true` for `["true"]`,
`ok: false` for `["false"]`, `ok: false` with `expect` unmatched for `["echo", "DOWN"]` with
`expect: "\\bUP\\b"`, and `ok: false` rather than throwing for a missing binary. Bound every real
call with a timeout so no test can hang.

- [ ] **Step 2: Run to verify they fail. Step 3: implement. Step 4: verify they pass.**

Follow the envelope helpers and `--json` handling used by `apps/refarm/src/commands/workspace.ts`.
Human output should read as a short table: name, state, and the reason when not `up`.

- [ ] **Step 5: Register the command in `program.ts`, type-check, and commit.**

---

### Task 3: The doctor finding

**Files:**
- Modify: `apps/refarm/src/commands/doctor.ts` (or the diagnostics module it reads from — find where `recommendations` are produced)
- Test: extend `apps/refarm/test/commands/doctor.test.ts` or add a focused file

**Behaviour:** a declared connection whose `establish` or `probe` binary does not resolve becomes a
doctor finding naming the connection and the missing binary, with `refarm connection status --json`
as its `nextCommand`. A declaration with a validation issue (shell probe, missing probe, non-zero
idle linger) is also a finding. A catalog with no connections declared produces **no** finding — an
absent catalog is not a defect.

Severity: `warning`, not `failure` — a missing connection binary does not make the host unusable, and
`refarm doctor`'s failures gate other flows.

- [ ] **Steps:** write the failing test, run it, implement, verify, type-check, commit.

---

### Task 4: Record it

**Files:** `docs/CONVERGENCE-LANE.md`, `docs/decision-log.md`

Append what shipped under the 2026-07-28 declared-connections entry, with the real test counts. Note
that the WIT surface and the `connection:use` permission remain operator-gated and unstarted.

---

## Follow-on (not this plan)

- The live half of D12 — claims, since-when, and which plugins hold them — needs the host registry to
  be reachable from the CLI, which needs the WIT surface (operator-gated) or a sidecar endpoint.
  Until then `connection status` reports what the probe can prove, which is the part that matters
  most: whether the connection is actually up.
- D13's attention handshake, and step 3 supervision built on it.

## Self-Review

**Spec coverage:** D12's declared/binary-resolves/is-it-up/last-failure reporting → Tasks 1-2; the
doctor finding → Task 3; the claims half is explicitly deferred with its blocker named. D1b's probe
semantics (exit 0 AND `expect`) → Task 2's `runProbeProcess`. D1c's shell rejection → Task 1.

**Placeholder scan:** Task 1 carries complete test code and precise implementation rules; Tasks 2-3
specify behaviour, interfaces, states, severities and the precedent file to copy, with the test
matrix enumerated. No "TBD", no "add error handling".

**Type consistency:** `DeclaredConnection`, `ConnectionProbe` and `CatalogIssue` are defined in Task
1 and consumed unchanged in Tasks 2-3; `reportConnections` and `runProbeProcess` share the
`{ ok, detail? }` result shape.
