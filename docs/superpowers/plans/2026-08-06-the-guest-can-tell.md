# The Guest Can Tell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a plugin the ability to know whether the rows it received are all of them — and fix the budget guard that has been failing open because it could not.

**Architecture:** `query-nodes` changes in place to return a record carrying the rows, how many exist, and whether the answer was cut. The WIT is the single source and the bindings are generated, so the blast radius is two crates with call sites. No second blind function is left behind.

**Tech Stack:** WIT (`packages/plugin-wit`), Rust host (`packages/tractor`), Rust guests (`packages/agent`, `packages/delegate`), one WASM component rebuild.

**Predecessors:** `docs/SOVEREIGN_RECORD_ORDERING.md` names this as an open gap. The ordering and truncation work it records is complete on `develop`.

## Why in place rather than additive

The operator chose this after seeing the measured cost, and the measurement is the argument.

`bindings.rs` is **generated and gitignored** — `git ls-files` returns nothing for any of the six, `packages/agent/.gitignore:2` lists it, and `scripts/ci/check-no-tracked-artifacts.mjs` fails CI if one is ever tracked. So the WIT is already the single source of truth; there is no duplication to centralise first.

Measured blast radius:

| Crate | Bindings | Calls `query_nodes`? |
| --- | --- | --- |
| `agent` | regenerates | **yes — 7 sites** |
| `delegate` | regenerates | **yes — 1 site** |
| `lsp-code-ops` | regenerates | no |
| `pi-agent` | regenerates | no |
| `scarecrow-plugin` | regenerates | no |
| `identity-provider-ref` | regenerates | no |

Every installed plugin on the operator's node (`refarm_agent`, `refarm_lsp-code-ops`, `@refarm/*`) has in-repo sources. No third-party compiled plugin exists yet, which makes now the cheap moment.

The decisive argument is not cost, it is what an additive change would leave behind: two functions doing the same job, the shorter-named and easier-to-reach one being the one that cannot tell the truth about truncation. This entire line of work has been about surfaces that could not say "I do not know". Keeping the blind one alive guarantees someone reaches for it.

**Honest caveat, recorded rather than buried:** this is a breaking change to a versioned package, `plugin:host@0.1.0`. A third-party plugin compiled against the current shape would fail to instantiate. None exists today.

## The case that makes this urgent

`packages/agent/src/session/wasm_ops.rs:330` is a **budget guard**:

```rust
let records = tractor_bridge::query_nodes("UsageRecord", 10_000).unwrap_or_default();
sum_provider_spend_usd(&records, provider_name, now_ns(), WINDOW_30D_NS) >= budget
```

It has two silent failure modes and **both fail toward "not over budget"**:

1. **Truncation.** Past 10,000 `UsageRecord` rows it sums a subset without knowing, so the total is an undercount and the guard lets spending through.
2. **Error.** `.unwrap_or_default()` turns a failed query into an empty vector, so the sum is zero and the guard is off entirely.

Before the ordering fix this was worse: it took the OLDEST 10,000, which against a 30-day window would be mostly outside it — a sum near zero and a guard that was effectively disabled. The ordering fix already improved it materially; this plan lets it know when it cannot answer.

## Global Constraints

- **Three states, never two.** A guard that cannot establish the total must not conclude "under budget". Six instruments in this line of work were caught reporting results they had not earned, and the sixth was introduced by the fix for the fifth. Assume this plan is exposed to the same failure.
- **No second blind function.** `query-nodes` changes; nothing is left that returns a bare list.
- **Rust build discipline (CLAUDE.md §7):** NO root Cargo workspace — cargo runs with cwd set to the crate dir. NEVER a bare `cargo test`. Build the agent with `pnpm --filter @refarm.dev/agent run build`, never `cargo component build`, which does not republish the file `refarm plugin install` reads.
- **The WASM rebuild happens once**, in Task 4.
- Do not run `pnpm run diagrams:fix` — it regenerates 42 diagrams and this machine's browser differs from CI's, dirtying ~35 unrelated SVGs.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/plugin-wit/wit/host.wit:17` | `query-nodes` returns a record. | 1 |
| `packages/tractor/src/host/wasi_bridge/core.rs:373-393` | Host fills the record. | 1 |
| `packages/agent/src/session/wasm_ops.rs`, `runtime/policy.rs`, `tool_dispatch/task_tools.rs` | Mechanical propagation. | 2 |
| `packages/delegate/src/lib.rs:230` | Mechanical propagation. | 2 |
| `packages/agent/src/session/wasm_ops.rs:317-332` | The budget guard stops failing open. | 3 |
| `docs/SOVEREIGN_RECORD_ORDERING.md` | Close the named gap. | 5 |

---

### Task 1: The contract carries the fact

**Files:**
- Modify: `packages/plugin-wit/wit/host.wit`
- Modify: `packages/tractor/src/host/wasi_bridge/core.rs`
- Test: the bridge's test module

**Interfaces:**
- Produces, in `interface tractor-bridge`:

```wit
    /// A page of nodes with the facts a caller needs to know whether it saw all of them.
    ///
    /// `query-nodes` returned a bare list until 2026-08-06, so a guest receiving exactly
    /// `limit` rows could not tell a complete answer from a cut one. The budget guard in the
    /// agent was summing a possibly-truncated set of UsageRecords and concluding "under
    /// budget" either way.
    record node-page {
        nodes: list<json-ld-node>,
        /// How many nodes of this type exist, independent of `limit`.
        stored: u32,
        /// True when `stored` exceeds what `nodes` carries.
        truncated: bool,
    }

    query-nodes: func(node-type: string, limit: u32) -> result<node-page, plugin-error>;
```

- [ ] **Step 1: Write the failing test**

Assert the host fills all three fields: with more rows stored than `limit`, `nodes.len() == limit`, `stored` is the true total, and `truncated` is true; with fewer stored than `limit`, `truncated` is false and `stored` equals `nodes.len()`.

Use DISTINCT `updated_at` values arranged so id order and timestamp order DISAGREE. A fixture where they coincide cannot tell the two sort keys apart — that mistake has been made repeatedly in this repo and caught each time.

- [ ] **Step 2: Run it to verify it fails**

cwd `packages/tractor`: `cargo test --lib wasi_bridge --quiet` with your filter.

- [ ] **Step 3: Change the WIT and the host**

The host already has both facts: `query_nodes_limited` for the rows and `count_nodes` for the total, both on `NativeStorage`. `NativeSync` has a `query_nodes_limited` passthrough; add a `count_nodes` passthrough beside it if missing.

`truncated` must be derived from `stored` versus the row count, not from `limit` — a caller passing a limit larger than the ceiling should still get `truncated: false` when everything fit.

- [ ] **Step 4: Verify**

cwd `packages/tractor`: `cargo test --lib wasi_bridge --quiet`, then `cargo check --quiet`.

Guests will not compile until Task 2. That is expected; do not patch them here.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-wit/wit/host.wit packages/tractor/src/host/wasi_bridge packages/tractor/src/sync
git commit -m "feat(bridge): the contract carries whether the answer was cut"
```

---

### Task 2: The guests compile again

**Files:**
- Modify: `packages/agent/src/session/wasm_ops.rs` (5 sites), `packages/agent/src/runtime/policy.rs:128`, `packages/agent/src/tool_dispatch/task_tools.rs:8,44`
- Modify: `packages/delegate/src/lib.rs:230`

This task is mechanical: each caller now receives a record and takes `.nodes`. Do NOT change any behaviour here — the one site whose behaviour must change is the budget guard, and it gets its own task so the mechanical diff stays reviewable.

Where a call site uses `.unwrap_or_default()`, leave it as it is for now EXCEPT where Task 3 says otherwise. Note in your report every site where the newly-available `truncated` is being discarded, so Task 3 and the follow-up ledger know what was left on the table.

- [ ] **Step 1: Regenerate and see what breaks**

cwd `packages/agent`: `cargo check --target wasm32-wasip1 --quiet`
Expected: type errors at each call site. That list IS the work.

- [ ] **Step 2: Propagate**

- [ ] **Step 3: Verify both guests**

cwd `packages/agent`: `cargo check --target wasm32-wasip1 --quiet` and `cargo test --lib session --quiet`
cwd `packages/delegate`: `cargo check --target wasm32-wasip1 --quiet`

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(guests): take the rows off the page"
```

---

### Task 3: The budget guard stops failing open

**Files:**
- Modify: `packages/agent/src/session/wasm_ops.rs:317-332`
- Test: `packages/agent/src/session/pure.rs` or wherever the decision can be tested natively

This is a behaviour change and the reason the plan exists.

Today the guard answers a boolean: over budget, or not. It has no way to say "I could not establish the total", so both a truncated read and a failed read collapse into "not over budget" — the permissive answer, on a guard whose job is to stop spending.

**The decision is yours to make and to justify in the code**, and the plan deliberately does not dictate it, because it is a policy question about the operator's money rather than a mechanical fix:

- Fail CLOSED (treat unknown as over budget) protects the wallet and can block work the operator wanted, on a node with a large `UsageRecord` history.
- Fail OPEN but LOUD (proceed while emitting telemetry) preserves today's behaviour and makes it visible.
- A third state in the return type pushes the decision to the caller, which may be right if the caller has context this function lacks.

Whichever you choose: the code must state which it chose and why, the unknown case must be distinguishable from the known-under case, and a test must pin it. Extract the decision into a natively-testable pure function as the session helpers already do — `mod wasm_ops` is `#[cfg(target_arch = "wasm32")]` and is not compiled natively.

Also address the `.unwrap_or_default()` on the query itself: an error is not evidence of zero spend.

- [ ] **Step 1: Write the failing test** — cover known-under, known-over, truncated, and query-error.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement, documenting the policy choice in the function.**
- [ ] **Step 4: Verify.** cwd `packages/agent`: `cargo test --lib --quiet` with your filter, then `cargo check --target wasm32-wasip1 --quiet`.
- [ ] **Step 5: Commit.**

---

### Task 4: Build, install, prove

**Files:** none — evidence.

- [ ] **Step 1: Build everything that changed**

```bash
pnpm --filter @refarm.dev/agent run build
cd packages/tractor && cargo build --release && cd -
pnpm --filter @refarm.dev/refarm run build
```

- [ ] **Step 2: Install and restart**

```bash
refarm plugin install
refarm runtime restart
refarm context
```

The loaded and built plugin hashes must be EQUAL and BOTH different from `cff89975`, the value before this plan. If only one changed, the install did not take.

- [ ] **Step 3: Harness**

cwd `packages/tractor`: `cargo test --test agent_harness session -- --ignored --test-threads=1`
Export `CARGO_TARGET_DIR` if it reports a missing `agent.wasm` — a documented gotcha, not a regression.

- [ ] **Step 4: Prove the node still works end to end**

```bash
refarm sessions list --json | head -20
refarm budget observations --limit 1 --json | python3 -c "
import sys,json,datetime
d=json.load(sys.stdin); o=d['observations']
print('newest:', datetime.datetime.fromtimestamp(o[0]['timestamp_ns']/1e9).isoformat())
print('stored:', d.get('stored'), '| truncated:', d.get('truncated'))
"
```

Expected: sessions resolve, and the observations reader still returns the newest with its truncation facts — proving the WIT change did not regress the predecessors.

Do NOT run `refarm ask`; it consumes the operator's real subscription quota and nothing here needs a new observation.

- [ ] **Step 5: Gate and commit the evidence**

```bash
refarm agent finish --lane after-edit --run --json
git commit --allow-empty -m "test(bridge): the guest can tell now, measured on the node"
```

---

### Task 5: Close the gap in the contract document

**Files:** Modify `docs/SOVEREIGN_RECORD_ORDERING.md`

- [ ] **Step 1:** The document names "the guest has no truncation signal" as a deferred gap. It is closed — say so, say how, and record that `query-nodes` changed shape in a versioned package with no third-party plugin existing at the time.
- [ ] **Step 2:** Record what the budget guard did before and what it does now. That is the concrete harm the missing signal was causing, and it is the most useful thing in the entry.
- [ ] **Step 3:** Note any call site Task 2 reported as still discarding `truncated`, so the next reader knows what remains rather than assuming the propagation was total.
- [ ] **Step 4:** Commit.

---

## Self-Review

| Requirement | Task |
| --- | --- |
| `query-nodes` carries rows, total, truncated | 1 |
| `truncated` derived from stored vs rows, not from limit | 1 |
| No second blind function left behind | 1 (in-place change) |
| Every call site compiles | 2 |
| Discarded `truncated` sites recorded | 2, 5 |
| The budget guard can say "I do not know" | 3 |
| The query error stops meaning zero spend | 3 |
| One WASM rebuild, via the path that republishes `dist` | 4 |
| Proven without regressing the predecessors | 4 |
| The deferred gap is closed in writing | 5 |

**Known follow-up, out of scope:** `GET /tasks` (`packages/tractor/src/sidecar/mod.rs:1718,1746,1752`) still holds the unlimited query, a second sort order, and a silent truncate, and it disagrees with its guest sibling about "the newest N tasks". Paging past `MAX_NODES_PER_RESPONSE` also remains absent.
