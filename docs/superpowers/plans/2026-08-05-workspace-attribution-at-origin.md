# Workspace Attribution at the Origin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `refarm ask` dispatch carry the workspace it belongs to, so the budget record can separate one project's cost from another's.

**Architecture:** One resolved value in `ask.ts` travels two ways for two purposes — `Effort.workspaceId` at the root reaches the `BudgetObservation` through plumbing that already exists, and `args.workspace_id` reaches the agent, which stamps it on the `Session` node so later runs in the same session inherit it. Resolution is a pure function that reads no ambient state; the path it resolves is supplied by the interactive CLI entry and by nothing else.

**Tech Stack:** TypeScript (apps/refarm, vitest), Rust (packages/agent, `cargo test --lib`), WASM component (`cargo component build --release -p agent`), harness (`cargo test --test agent_harness -- --ignored`).

**Spec:** `docs/superpowers/specs/2026-08-05-workspace-attribution-at-origin-design.md`

## Global Constraints

- **The resolver reads no ambient state.** No `process.cwd()`, no `process.env`, no config load inside the resolution function. Path and declared roots arrive as parameters. This is the shape the 2026-08-03 field fix took, and the reason `parseWorkspaceOption` carries the "declared, never detected" ruling.
- **`refarm dispatch` is not touched.** Its no-cwd-fallback rule (`dispatch-capability.ts:136-153`) stays exactly as it is. Only `refarm ask` gains a seed, and only stamped as a seed.
- **Absent means absent.** A field never declared produces no key at all — never `""`, never `null`. Match the existing spread idiom in `runtime-agent-effort.ts:82-87`.
- **Two provenance values only:** `declared` and `seeded-from-cwd`. A session with no workspace carries neither `workspace_id` nor `workspace_source`.
- **Rust build discipline (CLAUDE.md §7):** never bare `cargo test`. Use `cargo test --lib <filter>` or a named `--test`. The WASM rebuild happens once, in Task 5.
- **Source sovereignty:** edits in `src/` only. `packages/agent` is TS-Strict-adjacent Rust; `apps/refarm` is TypeScript with `.js` import specifiers.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/refarm/src/commands/workspace-from-path.ts` | **New.** Pure path → workspace-id resolution and its tie-breaking rules. No I/O. | 1 |
| `apps/refarm/src/commands/workspace-from-path.test.ts` | **New.** Resolution rules under adversarial paths. | 1 |
| `apps/refarm/src/commands/runtime-agent-effort.ts` | Carry `workspaceId` on the Effort root and `workspace_id` in args. | 2 |
| `apps/refarm/src/commands/runtime-agent-effort.test.ts` | **New if absent.** Effort shape assertions. | 2 |
| `packages/agent/src/session/pure.rs` | `session_node` gains two optional fields. | 3 |
| `packages/agent/src/tests/session_schema_tests.rs` | Node shape assertions for present and absent workspace. | 3 |
| `packages/agent/src/lib.rs` | `RespondPayload.workspace_id` + `EnvGuard` for `MODEL_WORKSPACE_ID`. | 4 |
| `packages/agent/src/session/wasm_ops.rs` | `get_or_create_session` stamps the workspace when creating the node. | 4 |
| `apps/refarm/src/commands/ask.ts` | `--workspace` flag, the four-degree ladder, session read-back. | 5 |
| `apps/refarm/src/commands/ask.test.ts` | Ladder precedence tests. | 5 |

---

### Task 1: The pure resolver

The only piece with real judgment in it. Everything else is wiring.

**Files:**
- Create: `apps/refarm/src/commands/workspace-from-path.ts`
- Test: `apps/refarm/src/commands/workspace-from-path.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface DeclaredRoot { id: string; absolutePath: string }`
  - `export function resolveWorkspaceFromPath(candidatePath: string, roots: DeclaredRoot[]): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `apps/refarm/src/commands/workspace-from-path.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { type DeclaredRoot, resolveWorkspaceFromPath } from "./workspace-from-path.js";

const ROOTS: DeclaredRoot[] = [
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5/rcdc5" },
	{ id: "refarm", absolutePath: "/home/op/github/refarm" },
];

describe("resolveWorkspaceFromPath", () => {
	it("resolves a path inside a declared root", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm/apps", ROOTS)).toBe("refarm");
	});

	it("resolves the root itself", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm", ROOTS)).toBe("refarm");
	});

	it("returns undefined outside every declared root — never a nearest match", () => {
		expect(resolveWorkspaceFromPath("/home/op/elsewhere", ROOTS)).toBeUndefined();
	});

	it("returns undefined when nothing is declared", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm", [])).toBeUndefined();
	});

	it("longest matching prefix wins for nested roots", () => {
		const nested: DeclaredRoot[] = [
			{ id: "outer", absolutePath: "/home/op/git" },
			{ id: "inner", absolutePath: "/home/op/git/rcdc5" },
		];
		expect(resolveWorkspaceFromPath("/home/op/git/rcdc5/pkg", nested)).toBe("inner");
		expect(resolveWorkspaceFromPath("/home/op/git/other", nested)).toBe("outer");
	});

	it("a shared string prefix is not containment — the boundary must be a separator", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm-old", ROOTS)).toBeUndefined();
	});

	it("normalises traversal before comparing", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm/apps/..", ROOTS)).toBe("refarm");
	});

	it("a relative candidate path resolves nothing — callers pass absolute paths", () => {
		expect(resolveWorkspaceFromPath("apps/refarm", ROOTS)).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/workspace-from-path.test.ts`
Expected: FAIL — cannot resolve `./workspace-from-path.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/refarm/src/commands/workspace-from-path.ts`:

```typescript
import path from "node:path";

/**
 * A declared workspace reduced to what attribution needs: its id and where it lives.
 * Callers build these from the config catalog; this module never reads config itself.
 */
export interface DeclaredRoot {
	id: string;
	absolutePath: string;
}

/**
 * The workspace id a path belongs to, or `undefined` when it belongs to none.
 *
 * PURE BY CONSTRUCTION, and that is the point rather than a style preference. The
 * 2026-08-03 field failure was `process.cwd()` read ambiently, deep in resolution, by a
 * process whose cwd was the daemon's — the operator saw
 * `Command "code-boundaries" is not declared for workspace "rcdc5"`. This function reads
 * no cwd, no environment and no config: a caller that has no meaningful path passes none
 * and gets nothing, which is how a node-created session stays honestly unattributed.
 *
 * `undefined`, never `""`: the same "absent means absent" contract `Effort.workspaceId`
 * and the sidecar's `workspace_id: Option<String>` already carry.
 */
export function resolveWorkspaceFromPath(
	candidatePath: string,
	roots: DeclaredRoot[],
): string | undefined {
	if (!path.isAbsolute(candidatePath)) return undefined;
	const candidate = path.resolve(candidatePath);

	let best: { id: string; length: number } | undefined;
	for (const root of roots) {
		if (!path.isAbsolute(root.absolutePath)) continue;
		const rootPath = path.resolve(root.absolutePath);
		if (!isWithin(candidate, rootPath)) continue;
		// Longest matching prefix wins: with a root declared inside another, being in the
		// inner one attributes to the inner one, which is the more specific true statement.
		if (!best || rootPath.length > best.length) {
			best = { id: root.id, length: rootPath.length };
		}
	}
	return best?.id;
}

/**
 * Containment on path BOUNDARIES, not on string prefixes: `/home/op/refarm-old` shares
 * eleven characters with `/home/op/refarm` and is a different directory entirely.
 */
function isWithin(candidate: string, root: string): boolean {
	if (candidate === root) return true;
	const relative = path.relative(root, candidate);
	return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/workspace-from-path.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @refarm.dev/refarm run type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/refarm/src/commands/workspace-from-path.ts apps/refarm/src/commands/workspace-from-path.test.ts
git commit -m "feat(workspace): a path can say which workspace it is in, without asking the environment"
```

---

### Task 2: The Effort carries the workspace

**Files:**
- Modify: `apps/refarm/src/commands/runtime-agent-effort.ts:4-99`
- Test: `apps/refarm/src/commands/runtime-agent-effort.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (the value arrives already resolved).
- Produces: `RuntimeAgentRespondEffortOptions` gains `workspaceId?: string` and `workspaceSource?: "declared" | "seeded-from-cwd"`. When `workspaceId` is present the returned `Effort` carries root-level `workspaceId`, and `tasks[0].args.workspace_id` plus `tasks[0].args.workspace_source`.

- [ ] **Step 1: Write the failing test**

Create `apps/refarm/src/commands/runtime-agent-effort.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createRuntimeAgentRespondEffort } from "./runtime-agent-effort.js";

const BASE = {
	prompt: "p",
	system: "s",
	sessionId: "urn:sovereign:session:v1:abc",
	source: "refarm-ask" as const,
	historyTurns: 10,
	now: () => new Date("2026-08-05T00:00:00.000Z"),
	randomUUID: () => "fixed-uuid",
};

describe("createRuntimeAgentRespondEffort workspace attribution", () => {
	it("omits every workspace key when none is declared", () => {
		const effort = createRuntimeAgentRespondEffort(BASE);
		expect("workspaceId" in effort).toBe(false);
		expect("workspace_id" in effort.tasks[0].args).toBe(false);
		expect("workspace_source" in effort.tasks[0].args).toBe(false);
	});

	it("carries the id at the root for the observation and in args for the session", () => {
		const effort = createRuntimeAgentRespondEffort({
			...BASE,
			workspaceId: "rcdc5",
			workspaceSource: "declared",
		});
		expect(effort.workspaceId).toBe("rcdc5");
		expect(effort.tasks[0].args.workspace_id).toBe("rcdc5");
		expect(effort.tasks[0].args.workspace_source).toBe("declared");
	});

	it("records a seed as a seed", () => {
		const effort = createRuntimeAgentRespondEffort({
			...BASE,
			workspaceId: "refarm",
			workspaceSource: "seeded-from-cwd",
		});
		expect(effort.tasks[0].args.workspace_source).toBe("seeded-from-cwd");
	});

	it("a whitespace-only id is no declaration at all", () => {
		const effort = createRuntimeAgentRespondEffort({ ...BASE, workspaceId: "   " });
		expect("workspaceId" in effort).toBe(false);
		expect("workspace_id" in effort.tasks[0].args).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/runtime-agent-effort.test.ts`
Expected: FAIL — `effort.workspaceId` is `undefined`.

- [ ] **Step 3: Add the option to the interface**

In `apps/refarm/src/commands/runtime-agent-effort.ts`, after the `expectation` field (line 44), insert:

```typescript
	/**
	 * WHICH WORKSPACE this run belongs to — the axis that separates one project's cost
	 * from another's, measured blank on 16 of 16 `refarm ask` runs before this existed.
	 *
	 * Travels TWICE, to two consumers, from one resolved value: at the Effort root for
	 * the sidecar, which writes `refarm.workspace.id` onto the BudgetObservation, and in
	 * `args` for the agent, which stamps it on the Session node so later runs in the same
	 * session inherit it instead of re-deriving.
	 *
	 * Absent when nobody declared one, exactly like `scenarioId` and `expectation`.
	 */
	workspaceId?: string;
	/**
	 * HOW the workspace above was arrived at: `declared` when a human typed
	 * `--workspace`, `seeded-from-cwd` when it was inferred at session creation from the
	 * directory the operator stood in.
	 *
	 * Not decoration. `workspaceId` selects budget folds and, later, per-workspace policy,
	 * and ADR-094's H2 permits cwd as authoring convenience but not as policy truth. A
	 * seed that could not be told apart from a declaration would honour that rule in form
	 * while breaking it in substance.
	 */
	workspaceSource?: "declared" | "seeded-from-cwd";
```

- [ ] **Step 4: Destructure and emit**

Change the destructuring (line 49-62) to include the two new names after `expectation`:

```typescript
	expectation,
	workspaceId,
	workspaceSource,
	now = () => new Date(),
```

After `const declaredExpectation = expectation?.trim();` (line 74), add:

```typescript
	const declaredWorkspace = workspaceId?.trim();
```

Inside the `args` object construction, after the `profile` line (line 71), add:

```typescript
	if (declaredWorkspace) {
		args.workspace_id = declaredWorkspace;
		if (workspaceSource) args.workspace_source = workspaceSource;
	}
```

And in the returned object, after the `expectation` spread (line 87), add:

```typescript
		// Same spread-or-nothing rule as the two above. The root field is what the sidecar
		// reads onto the observation; `args.workspace_id` above is what the agent reads onto
		// the Session node. One value, two readers, no null between them.
		...(declaredWorkspace ? { workspaceId: declaredWorkspace } : {}),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/runtime-agent-effort.test.ts`
Expected: PASS, 4 tests.

If `Effort` from `@refarm.dev/effort-contract-v1` has no `workspaceId` on its type, add it there as an optional field mirroring `scenarioId`, then rebuild that package: `pnpm --filter @refarm.dev/effort-contract-v1 run build`.

- [ ] **Step 6: Type-check and commit**

```bash
pnpm --filter @refarm.dev/refarm run type-check
git add apps/refarm/src/commands/runtime-agent-effort.ts apps/refarm/src/commands/runtime-agent-effort.test.ts
git commit -m "feat(effort): one resolved workspace, two readers — the observation and the session"
```

---

### Task 3: The Session node has somewhere to put it

**Files:**
- Modify: `packages/agent/src/session/pure.rs:142-159`
- Test: `packages/agent/src/tests/session_schema_tests.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `session_node(id, name, leaf_entry_id, parent_session_id, created_at_ns, workspace: Option<(&str, &str)>)` — the tuple is `(workspace_id, workspace_source)`. When `None`, neither key appears in the JSON.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent/src/tests/session_schema_tests.rs`:

```rust
#[test]
fn session_without_workspace_carries_neither_key() {
    let node = crate::session::pure::session_node("s1", None, None, None, 42, None);
    assert!(
        node.get("workspace_id").is_none(),
        "an unattributed session must carry no workspace_id key at all, not a null"
    );
    assert!(node.get("workspace_source").is_none());
}

#[test]
fn session_with_workspace_carries_id_and_provenance() {
    let node = crate::session::pure::session_node(
        "s1",
        None,
        None,
        None,
        42,
        Some(("rcdc5", "seeded-from-cwd")),
    );
    assert_eq!(node["workspace_id"], "rcdc5");
    assert_eq!(
        node["workspace_source"], "seeded-from-cwd",
        "a seed must stay legible as a seed: workspace_id selects budget folds, and \
         ADR-094 H2 allows cwd as authoring convenience but not as policy truth"
    );
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --lib -p agent session_with_workspace --quiet`
Expected: FAIL to compile — `session_node` takes 5 arguments, 6 supplied.

- [ ] **Step 3: Widen `session_node`**

In `packages/agent/src/session/pure.rs`, replace the function (lines 142-159):

```rust
/// `workspace`: `(workspace_id, workspace_source)` when this session is attributed to a
/// workspace, `None` when it is not. Absent means absent — an unattributed session carries
/// NEITHER key rather than a null, because a null here would read as "attributed to
/// nothing in particular" where the truth is "nobody has said yet."
pub(crate) fn session_node(
    id: &str,
    name: Option<&str>,
    leaf_entry_id: Option<&str>,
    parent_session_id: Option<&str>,
    created_at_ns: u64,
    workspace: Option<(&str, &str)>,
) -> serde_json::Value {
    let mut node = serde_json::json!({
        "@type":             "Session",
        "@id":               id,
        "participants":      [default_session_participant()],
        "context_id":        serde_json::Value::Null,
        "name":              name,
        "leaf_entry_id":     leaf_entry_id,
        "parent_session_id": parent_session_id,
        "created_at_ns":     created_at_ns,
    });
    if let Some((workspace_id, workspace_source)) = workspace {
        let map = node.as_object_mut().expect("session_node builds an object");
        map.insert("workspace_id".into(), workspace_id.into());
        map.insert("workspace_source".into(), workspace_source.into());
    }
    node
}
```

- [ ] **Step 4: Fix the three existing call sites to pass `None`**

`packages/agent/src/session/wasm_ops.rs:55` and `:134` each gain a trailing `None`. Any call in `packages/agent/src/tests/` likewise.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --lib -p agent session --quiet`
Expected: PASS, including the pre-existing `session_schema_tests`.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/session/pure.rs packages/agent/src/tests/session_schema_tests.rs packages/agent/src/session/wasm_ops.rs
git commit -m "feat(session): the node can say which workspace it belongs to, and how it learned"
```

---

### Task 4: The workspace reaches the agent and lands on the session

**Files:**
- Modify: `packages/agent/src/lib.rs:228-238` (payload), `:359-368` (respond), and the second `EnvGuard` site near `:406`
- Modify: `packages/agent/src/session/wasm_ops.rs:130-146`

**Interfaces:**
- Consumes: `session_node(..., workspace: Option<(&str, &str)>)` from Task 3; `args.workspace_id` / `args.workspace_source` from Task 2.
- Produces: `MODEL_WORKSPACE_ID` and `MODEL_WORKSPACE_SOURCE` scoped env vars for the duration of a respond call; `get_or_create_session()` stamps them when it creates a node.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent/src/tests/session_schema_tests.rs`:

```rust
#[test]
fn respond_payload_accepts_workspace_attribution() {
    let payload: crate::RespondPayload = serde_json::from_value(serde_json::json!({
        "prompt": "p",
        "session_id": "urn:sovereign:session:v1:abc",
        "workspace_id": "rcdc5",
        "workspace_source": "declared",
    }))
    .expect("respond payload must deserialise workspace attribution");
    assert_eq!(payload.workspace_id.as_deref(), Some("rcdc5"));
    assert_eq!(payload.workspace_source.as_deref(), Some("declared"));
}

#[test]
fn respond_payload_without_workspace_is_still_valid() {
    let payload: crate::RespondPayload =
        serde_json::from_value(serde_json::json!({ "prompt": "p" }))
            .expect("a dispatch that declares no workspace must still deserialise");
    assert!(payload.workspace_id.is_none());
}
```

`RespondPayload` is private; add `pub(crate)` to the struct and to the two new fields so the test module can see it, matching how the crate's other test-visible types are exposed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --lib -p agent respond_payload --quiet`
Expected: FAIL to compile — no field `workspace_id` on `RespondPayload`.

- [ ] **Step 3: Add the payload fields**

In `packages/agent/src/lib.rs`, inside `struct RespondPayload` (after `profile`, line 237):

```rust
    /// Which workspace this run belongs to, and how that was arrived at. Declared by the
    /// caller, never derived here: the guest has no directory of its own worth consulting,
    /// and a workspace guessed inside the WASM would be exactly the ambient read the
    /// 2026-08-03 field failure was about.
    workspace_id: Option<String>,
    workspace_source: Option<String>,
```

- [ ] **Step 4: Scope them for the call**

In `execute_respond` (line 362), beside the existing session guard:

```rust
    let _workspace = EnvGuard::maybe_set("MODEL_WORKSPACE_ID", req.workspace_id.as_deref());
    let _workspace_source =
        EnvGuard::maybe_set("MODEL_WORKSPACE_SOURCE", req.workspace_source.as_deref());
```

Add the same two lines at the second `MODEL_SESSION_ID` guard site near line 406, so both respond paths behave identically.

- [ ] **Step 5: Stamp the node at creation**

In `packages/agent/src/session/wasm_ops.rs`, replace `get_or_create_session` (lines 130-146):

```rust
pub(crate) fn get_or_create_session() -> String {
    if let Ok(id) = std::env::var("MODEL_SESSION_ID") {
        if !id.is_empty() {
            if tractor_bridge::get_node(&id).is_err() {
                // Bound first: `declared_workspace()` returns owned Strings, and
                // `session_node` borrows. Inlining the call would drop the temporary
                // while the borrow is still live.
                let declared = declared_workspace();
                let workspace = declared.as_ref().map(|(id, source)| (id.as_str(), source.as_str()));
                let node = session_node(&id, None, None, None, now_ns(), workspace);
                let _ = tractor_bridge::store_node(&node.to_string());
            }
            return id;
        }
    }

    if let Some(latest_id) = latest_session_id(20) {
        return latest_id;
    }

    store_new_session(None).unwrap_or_else(new_session_id)
}

/// The workspace attribution declared for THIS call, or `None`.
///
/// Read only where a Session node is CREATED. An existing session keeps whatever it was
/// created with: the declaration is the session's, not the dispatch's, so a later run from
/// another directory cannot silently re-attribute a conversation already under way.
fn declared_workspace() -> Option<(String, String)> {
    let id = std::env::var("MODEL_WORKSPACE_ID").ok().filter(|v| !v.trim().is_empty())?;
    let source = std::env::var("MODEL_WORKSPACE_SOURCE")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "declared".to_string());
    Some((id, source))
}
```

`store_new_session` (line 53) keeps passing `None`: it creates a session nobody addressed by id,
which is the daemon's own bookkeeping rather than an operator's dispatch, and inventing an
attribution there is exactly what "undeclared stays undeclared" refuses.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test --lib -p agent session --quiet && cargo test --lib -p agent respond_payload --quiet`
Expected: PASS.

- [ ] **Step 7: Check the WASM target compiles before paying for a release build**

Run: `cargo check --target wasm32-wasip1 -p agent --quiet`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/lib.rs packages/agent/src/session/wasm_ops.rs packages/agent/src/tests/session_schema_tests.rs
git commit -m "feat(agent): a declared workspace reaches the session it belongs to"
```

---

### Task 5: The ladder in `refarm ask`

**Files:**
- Modify: `apps/refarm/src/commands/ask.ts` — flag registration near `:381`, resolution before `:606`
- Test: `apps/refarm/src/commands/ask.test.ts`

**Interfaces:**
- Consumes: `resolveWorkspaceFromPath` (Task 1), the effort options (Task 2), the stamped Session node (Tasks 3-4).
- Produces: `export function resolveDispatchWorkspace(input): { workspaceId?: string; workspaceSource?: "declared" | "seeded-from-cwd" }` where `input` is `{ flag?: string; sessionWorkspace?: { id: string; source: string }; interactiveCwd?: string; roots: DeclaredRoot[] }`.

- [ ] **Step 1: Write the failing test**

Create or append to `apps/refarm/src/commands/ask.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveDispatchWorkspace } from "./ask.js";

const ROOTS = [
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5" },
	{ id: "refarm", absolutePath: "/home/op/github/refarm" },
];

describe("resolveDispatchWorkspace — the four degrees", () => {
	it("1. an explicit flag wins over everything and is recorded as declared", () => {
		expect(
			resolveDispatchWorkspace({
				flag: "rcdc5",
				sessionWorkspace: { id: "refarm", source: "declared" },
				interactiveCwd: "/home/op/github/refarm",
				roots: ROOTS,
			}),
		).toEqual({ workspaceId: "rcdc5", workspaceSource: "declared" });
	});

	it("2. an established session is inherited, and standing elsewhere does not steal it", () => {
		expect(
			resolveDispatchWorkspace({
				sessionWorkspace: { id: "rcdc5", source: "seeded-from-cwd" },
				interactiveCwd: "/home/op/github/refarm",
				roots: ROOTS,
			}),
		).toEqual({ workspaceId: "rcdc5", workspaceSource: "seeded-from-cwd" });
	});

	it("3. an unattributed session seeds from the operator's directory", () => {
		expect(
			resolveDispatchWorkspace({ interactiveCwd: "/home/op/git/rcdc5/pkg", roots: ROOTS }),
		).toEqual({ workspaceId: "rcdc5", workspaceSource: "seeded-from-cwd" });
	});

	it("4. no flag, no session, no interactive cwd — no workspace, no keys", () => {
		expect(resolveDispatchWorkspace({ roots: ROOTS })).toEqual({});
	});

	it("a caller with no meaningful directory seeds nothing — the node's case", () => {
		expect(
			resolveDispatchWorkspace({ interactiveCwd: undefined, roots: ROOTS }),
		).toEqual({});
	});

	it("standing outside every declared root attributes nothing", () => {
		expect(resolveDispatchWorkspace({ interactiveCwd: "/tmp", roots: ROOTS })).toEqual({});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/ask.test.ts`
Expected: FAIL — `resolveDispatchWorkspace` is not exported.

- [ ] **Step 3: Implement the ladder**

Add to `apps/refarm/src/commands/ask.ts`, near the other module-level helpers:

```typescript
import { type DeclaredRoot, resolveWorkspaceFromPath } from "./workspace-from-path.js";

export interface DispatchWorkspaceInput {
	/** `--workspace <id>`, already validated. */
	flag?: string;
	/** What the Session node already carries, when it carries anything. */
	sessionWorkspace?: { id: string; source: string };
	/**
	 * The directory a HUMAN was standing in, supplied only by the interactive CLI entry.
	 * Undefined for every other caller — a node opening a session for a Telegram thread has
	 * no directory worth consulting, and passing `process.cwd()` there would be the
	 * daemon-inherited read the 2026-08-03 field failure was made of.
	 */
	interactiveCwd?: string;
	roots: DeclaredRoot[];
}

/**
 * The four degrees, in order: explicit flag, the session's own declaration, a cwd seed at
 * a session's first dispatch, then nothing. cwd is absent from degrees 1 and 2 on purpose —
 * ADR-094's D2 keeps it out of the resolution order, and it enters here only as the
 * authoring convenience H2 permits, stamped so it can never be mistaken for a declaration.
 */
export function resolveDispatchWorkspace(input: DispatchWorkspaceInput): {
	workspaceId?: string;
	workspaceSource?: "declared" | "seeded-from-cwd";
} {
	const flag = input.flag?.trim();
	if (flag) return { workspaceId: flag, workspaceSource: "declared" };

	const inherited = input.sessionWorkspace;
	if (inherited?.id) {
		return {
			workspaceId: inherited.id,
			workspaceSource: inherited.source === "declared" ? "declared" : "seeded-from-cwd",
		};
	}

	if (input.interactiveCwd) {
		const seeded = resolveWorkspaceFromPath(input.interactiveCwd, input.roots);
		if (seeded) return { workspaceId: seeded, workspaceSource: "seeded-from-cwd" };
	}

	return {};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/ask.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Register the flag**

In the command builder near line 381, after `--expect`:

```typescript
		.option(
			"--workspace <id>",
			"Declare which workspace this run belongs to, so its cost separates from other projects'",
		)
```

- [ ] **Step 6: Wire it into the dispatch**

Before `createRuntimeAgentRespondEffort` (line 602), resolve once:

```typescript
				const declaredRoots = declaredWorkspaceRoots();
				const sessionWorkspace = await readSessionWorkspace(sessionId);
				const workspace = resolveDispatchWorkspace({
					flag: opts.workspace,
					sessionWorkspace,
					// The interactive entry, and only here, knows a human chose this directory.
					interactiveCwd: process.cwd(),
					roots: declaredRoots,
				});
```

Then pass into the factory call, after `expectation: opts.expect,`:

```typescript
					workspaceId: workspace.workspaceId,
					workspaceSource: workspace.workspaceSource,
```

`declaredWorkspaceRoots()` builds `DeclaredRoot[]` from the config catalog — reuse
`declaredWorkspacesFromConfig` and each entry's `absolutePath`, the same shape
`refarm workspace list --json` prints. `readSessionWorkspace(sessionId)` fetches `/sessions`
(the helper at line 194 already does this) and returns `{ id, source }` from the matching node's
`workspace_id` / `workspace_source`, or `undefined` when the node or the field is absent.

- [ ] **Step 7: Verify the whole package still passes**

Run: `pnpm --filter @refarm.dev/refarm run type-check && pnpm --filter @refarm.dev/refarm run test`
Expected: clean, no regressions.

- [ ] **Step 8: Commit**

```bash
git add apps/refarm/src/commands/ask.ts apps/refarm/src/commands/ask.test.ts
git commit -m "feat(ask): the run says which workspace it is for, without being asked every time"
```

---

### Task 6: Prove it on the node, not in the tests

The measurement that opened this work was live, and the check that closes it must be too.

**Files:** none — this task produces evidence.

- [ ] **Step 1: Build the agent component**

Run: `cargo component build --release -p agent`
Expected: succeeds. This is the one expensive build in the plan.

- [ ] **Step 2: Install the plugin and restart the node**

```bash
refarm plugin install
refarm doctor --json
```

Expected: no `runtime:stale` finding. If one appears, the running node predates the artifact — restart it before trusting anything below.

- [ ] **Step 3: Build the CLI**

Run: `pnpm --filter @refarm.dev/refarm run build`

- [ ] **Step 4: Run the harness for the session path**

Run: `cargo test --test agent_harness session -- --ignored --test-threads=1`
Expected: PASS.

- [ ] **Step 5: Prove the seed**

```bash
cd /home/s095407044/github/refarm && refarm ask "diga apenas: ok" --new --scenario workspace-axis-v1
refarm budget observations --limit 1 --json | grep -o '"refarm.workspace.id": *"[^"]*"'
```

Expected: `"refarm.workspace.id": "refarm"`.

- [ ] **Step 6: Prove the declaration and that the session holds it**

```bash
refarm ask "diga apenas: ok" --new --workspace rcdc5 --scenario workspace-axis-v1
refarm budget observations --limit 1 --json | grep -o '"refarm.workspace.id": *"[^"]*"'
refarm ask "diga apenas: ok" --scenario workspace-axis-v1   # same session, no flag
refarm budget observations --limit 1 --json | grep -o '"refarm.workspace.id": *"[^"]*"'
```

Expected: `rcdc5` on both — the second run inherits without the flag, from a directory that is not rcdc5's.

- [ ] **Step 7: Record the measurement**

Re-run the coverage audit from the spec and record the new numbers in the commit message:

```bash
refarm budget observations --limit 500 --json | python3 -c "
import sys,json
obs=json.load(sys.stdin)['observations']
n=len(obs); c=sum(1 for o in obs if o.get('refarm.workspace.id'))
recent=[o for o in obs if o.get('refarm.budget.spawner')=='refarm-ask'][:3]
print(f'workspace.id coverage: {c}/{n}')
print('last 3 ask runs:', [o.get('refarm.workspace.id') for o in recent])
"
```

- [ ] **Step 8: Run the gate and commit the evidence**

```bash
refarm agent finish --lane after-edit --run --json
git commit --allow-empty -m "test(workspace): the axis is populated on the node, measured not argued"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| Four-degree precedence | 5 |
| cwd seeds only at session creation | 4 (`declared_workspace()` read only on node creation) + 5 |
| `workspace_source` with exactly two values | 2, 3, 4, 5 |
| Resolver reads no ambient state | 1 (constraint enforced by signature) |
| Only the interactive entry supplies the path | 5 Step 6 |
| Longest prefix, path boundary, normalisation | 1 |
| Outside every root → none | 1, 5 |
| Session node carries the declaration durably | 3, 4 |
| End-to-end observation carries the id | 6 |
| `refarm dispatch` untouched | no task modifies `dispatch-capability.ts` |
| Non-goal: no `budget summary` | absent by construction |
| Non-goal: no back-filling | no task writes past observations |

**Type consistency:** `DeclaredRoot` and `resolveWorkspaceFromPath` (Task 1) are consumed under the same names in Task 5. `workspaceId` / `workspaceSource` are the TS names throughout Tasks 2 and 5; `workspace_id` / `workspace_source` are the wire and Rust names throughout Tasks 2, 3, 4. The `session_node` signature gains one parameter in Task 3 and every call site is updated in the same task.

**Known follow-up, out of scope:** a node-created session (Telegram, PWA) still has no seeding path. Task 3-4 give it a field to declare into; the surface-side declaration is separate work, recorded as seam 1 in the spec.
