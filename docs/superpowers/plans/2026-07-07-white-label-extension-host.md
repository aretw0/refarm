# White-Label Extension Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small declarative host facade so examples/apps can white-label their CLI, declare extensions, and expose multi-surface actions without hand-wiring Refarm projectors.

**Architecture:** `@refarm.dev/capabilities-v1` gains `defineCapabilityHost`, a facade over built-ins, app extension verbs, plugin manifests, status, surface actions, CLI projection, and HTTP serving. Consumers import this host facade once, declare their app identity and extensions, then call `host.registry()` / `host.program()` from their local entrypoint. App-specific actions stay declared by the app in its base status units; the host normalizes them into selectable `surfaceActions()`, `surfaceActionRows()`, and an `actions` capability.

**Tech Stack:** TypeScript, Vitest, Commander, `@refarm.dev/capabilities-v1`, `@refarm.dev/operator-state`.

---

### Task 1: Host Facade Contract

**Files:**
- Create: `packages/capabilities-v1/src/host.ts`
- Create: `packages/capabilities-v1/src/host.test.ts`
- Modify: `packages/capabilities-v1/src/index.ts`
- Modify: `packages/capabilities-v1/package.json`

- [x] **Step 1: Write the failing test**

Add a test proving that one host declaration builds a registry, CLI program, HTTP serve handle, and base status model without the consumer calling projector helpers.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @refarm.dev/capabilities-v1 exec vitest run src/host.test.ts`

Expected: FAIL because `defineCapabilityHost` does not exist yet.

- [x] **Step 3: Implement the minimal host facade**

Create `defineCapabilityHost(options)` with `registry()`, `baseModel()`, `surfaceActions()`, `surfaceActionRows()`, `surfaceContext()`, `program()`, and `serve()` methods. Keep the API declarative and white-label: app identity, command name, deps, extension verbs, plugin manifests, status units, surface actions, and optional serve command are declared in one object.

- [x] **Step 4: Export and validate**

Export the new facade from `packages/capabilities-v1/src/index.ts`. Add direct `commander` dependency because `program()` constructs the white-label CLI inside this package.

Run: `pnpm --filter @refarm.dev/capabilities-v1 exec vitest run src/host.test.ts src/mount.test.ts src/operator-state-capability.test.ts`

Expected: PASS.

- [x] **Step 5: Project host actions across surfaces**

Derive `actions` from the base model's unit actions, require stable IDs when the app provides them, expose them through `host.surfaceActions()`, and mount a generated `actions` capability so CLI/HTTP/TUI/agent all read one declaration.

### Task 2: Wallet T2 Migration

**Files:**
- Modify: `examples/wallet-t2/src/cli.ts`
- Modify: `examples/wallet-t2/src/flow.e2e.test.ts`
- Modify: `examples/wallet-t2/package.json`
- Modify: `examples/wallet-t2/README.md`

- [x] **Step 1: Write/update the wallet test**

Assert that `wallet-t2` still exposes the same verbs and base status, but its CLI module uses the host facade as the composition boundary.

- [x] **Step 2: Run wallet tests**

Run: `pnpm --filter wallet-t2 test`

Expected: FAIL until `cli.ts` is migrated.

- [x] **Step 3: Migrate `cli.ts`**

Replace projector imports with a single host declaration. Keep the local state path, persona verb, and wallet-specific status unit in the example; move registry/program/serve composition to the host facade.

- [x] **Step 4: Remove unnecessary app dependencies**

Drop direct `@refarm.dev/cli`, `@refarm.dev/operator-state`, and `commander` imports from `wallet-t2` where they are only present for host/projector plumbing.

- [x] **Step 5: Validate wallet**

Run:

```bash
pnpm --filter wallet-t2 test
pnpm --filter wallet-t2 run type-check
pnpm --filter wallet-t2 run build
```

Expected: PASS.

- [x] **Step 6: Normalize manual CLI naming**

Rename the T2 host command to `dgk`, expose the persona as `dgk wallet`, and update
package scripts, docs, and local state naming so exploratory runs do not repeat the
technical example folder name.

### Task 3: Repository Gate

**Files:**
- Verify all touched files.

- [x] **Step 1: Run package validation**

Run:

```bash
pnpm --filter @refarm.dev/capabilities-v1 run type-check
pnpm --filter @refarm.dev/capabilities-v1 run lint
pnpm --filter @refarm.dev/capabilities-v1 run build
```

Expected: PASS.

- [x] **Step 2: Run Refarm finish gate**

Run: `refarm agent finish --lane after-edit --run --json`

Expected: PASS and next command is `refarm resume --json`.

- [x] **Step 3: Commit** — landed as `24a78ee1`

Commit message: `feat(refarm): add white-label extension host`
