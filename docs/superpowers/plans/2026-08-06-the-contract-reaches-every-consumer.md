# The Ordering Contract Reaches Every Consumer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish what the record-reader plan started — every consumer of the sovereign graph inherits the newest-first order, stops materialising whole tables, and stops carrying a second sort order of its own.

**Architecture:** Three independent consumers still hold the old shape. The host bridge materialises everything and slices in Rust; the TypeScript sidecar client throws away the truncation facts the server now sends; the agent's session helper re-sorts on a different key than the one SQL ordered by. Each is fixed where it lives.

**Tech Stack:** Rust (`packages/tractor` host, `packages/agent` guest), TypeScript (`packages/sidecar-client`), one WASM component rebuild.

**Predecessor:** `docs/superpowers/plans/2026-08-06-the-record-reader-goes-blind.md` and `docs/SOVEREIGN_RECORD_ORDERING.md`. Read the latter before starting — it is the contract this plan propagates.

## Global Constraints

- **Never re-sort in a caller.** `SOVEREIGN_RECORD_ORDERING.md` states it and Task 3 exists because one caller does it anyway: two sort orders for one fact is how two answers drift apart.
- **Absent means absent.** A field the server did not send stays absent; never an invented `false` or a defaulted count. This exact defect was fixed in `budget.ts` last plan and must not be reintroduced in the client.
- **Three states, never two.** This session has hit the two-where-three-belong shape four times. If a consumer cannot know whether a result was truncated, it must be able to say so.
- **Rust build discipline (CLAUDE.md §7):** NO root Cargo workspace — every cargo command runs with cwd set to the crate directory. NEVER a bare `cargo test`. The WASM component rebuild is the single expensive step and happens once, in Task 4.
- **Do not change `host.wit`.** Giving the guest a truncation signal means changing `query-nodes: func(...) -> result<list<json-ld-node>, plugin-error>`, which every plugin implements. That is a contract addition deserving its own design, and it is explicitly deferred — recorded in Task 5's follow-ups, not smuggled in here.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/tractor/src/host/wasi_bridge/core.rs:373-387` | Stop materialising the whole table before slicing. | 1 |
| `packages/sidecar-client/src/index.ts:91-112` | Carry `stored` / `truncated` instead of discarding them. | 2 |
| `packages/agent/src/session/wasm_ops.rs:17-50` | Drop the second sort order; trust the order SQL gave. | 3 |
| `docs/SOVEREIGN_RECORD_ORDERING.md` | Record what changed and what is still deferred. | 5 |

---

### Task 1: The bridge stops loading the table to throw most of it away

**Files:**
- Modify: `packages/tractor/src/host/wasi_bridge/core.rs:373-387`
- Test: the bridge's own test module

**Interfaces:**
- Consumes: `query_nodes_limited(type_, limit)` from the predecessor plan.
- Produces: no signature change. `query_nodes(node_type, limit)` keeps returning `Vec<String>`; only how it obtains them changes.

Note the correctness half is ALREADY fixed: since `query_nodes` returns newest-first, `.take(limit)` yields the newest N. What remains is cost — the current code loads every row of that type before discarding all but `limit`.

- [ ] **Step 1: Write the failing test**

Assert that a guest asking for `limit` rows over a store holding more receives exactly `limit`, and that they are the NEWEST ones. Give the rows distinct `updated_at` values so the assertion turns on the order rather than on ids, following the fixture technique in `packages/tractor/src/storage/sqlite.rs`'s ordering tests — the same trap caught there applies here.

- [ ] **Step 2: Run it to verify it fails**

cwd `packages/tractor`: `cargo test --lib wasi_bridge --quiet` with your test's filter.
Expected: FAIL, or PASS-for-the-wrong-reason if the fixture does not distinguish order — check that before proceeding.

- [ ] **Step 3: Use the limited query**

```rust
    /// Query nodes by @type, returning up to `limit` results, NEWEST FIRST.
    ///
    /// The limit is applied in SQL rather than by slicing here. Before 2026-08-06 this
    /// loaded every row of the type and dropped all but `limit`, which was affordable at 29
    /// records and is not at 29,000. The ordering guarantee it relies on is documented in
    /// `docs/SOVEREIGN_RECORD_ORDERING.md`.
    ///
    /// KNOWN GAP, deliberately not closed here: the WIT signature returns a bare
    /// `list<json-ld-node>`, so a guest receiving exactly `limit` rows cannot tell whether
    /// more exist. Giving it that signal is a contract change affecting every plugin and
    /// belongs to its own design.
    async fn query_nodes(
        &mut self,
        node_type: String,
        limit: u32,
    ) -> Result<Vec<String>, PluginError> {
        self.sync
            .query_nodes_limited(&node_type, limit as usize)
            .map_err(|e| PluginError::Internal(e.to_string()))
            .map(|rows| rows.into_iter().map(|r| r.payload).collect())
    }
```

If `self.sync`'s type does not expose `query_nodes_limited`, add the passthrough at that layer rather than reaching around it.

- [ ] **Step 4: Verify and commit**

cwd `packages/tractor`: `cargo test --lib wasi_bridge --quiet`, then `cargo check --quiet`.

```bash
git add packages/tractor/src/host/wasi_bridge/core.rs
git commit -m "fix(bridge): the limit belongs in the query, not in a slice after it"
```

---

### Task 2: The client stops throwing away what the server now says

**Files:**
- Modify: `packages/sidecar-client/src/index.ts:91-112`
- Test: that package's test file

**Interfaces:**
- Produces: `queryNodes` returns `{ nodes: SidecarGraphNode[]; stored?: number; truncated?: boolean }` instead of a bare array.

- [ ] **Step 1: Write the failing test**

Cover three bodies, driven by literals with no network: one carrying `stored` and `truncated`, one omitting both (an older node), and one carrying `truncated` without `stored`. Assert the omitted fields come back `undefined` — never `false`, never a count derived from `nodes.length`. That derivation is exactly the defect fixed in `budget.ts` last plan.

- [ ] **Step 2: Run it to verify it fails**

`pnpm --filter @refarm.dev/sidecar-client exec vitest run` with your file's path.

- [ ] **Step 3: Implement, and update every caller**

Changing the return type is a breaking change inside this repo. Find every caller with `grep -rn "queryNodes" --include=*.ts apps packages | grep -v node_modules` and update each. If a caller genuinely only wants the array, destructure at the call site rather than adding a second function that hides the facts again.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @refarm.dev/sidecar-client run type-check
pnpm --filter @refarm.dev/sidecar-client run test
pnpm --filter @refarm.dev/refarm run type-check
git add packages/sidecar-client apps
git commit -m "fix(sidecar-client): a truncated answer stops looking like a whole one"
```

---

### Task 3: The session helper stops sorting by a different key than SQL did

**Files:**
- Modify: `packages/agent/src/session/wasm_ops.rs:17-50`
- Test: the agent's session test module

**Interfaces:** no signature change. `latest_session_id_with_v1_preference(limit)` keeps its contract.

The defect: the bridge returns rows newest-first by `updated_at`, and this function then re-sorts them with `max_by_key(created_at_ns)`. Session rows are UPSERTED on append, so most-recently-touched and most-recently-created are different facts. For "which session was I last in", most-recently-touched is the right answer and `updated_at` already gives it — so the re-sort is both redundant and wrong.

**Preserve the v1 preference.** It is deliberate: a `urn:sovereign:session:v1:` id is preferred over a legacy one. The corrected shape is "the FIRST v1-prefixed row in the order SQL already gave, else the first row of any shape" — not "take the first row".

- [ ] **Step 1: Write the failing test**

Assert that given rows in newest-touched-first order where the newest-touched has an OLDER `created_at_ns` than a later row, the function returns the newest-touched one. That case fails today and is the whole point. Add a second asserting the v1 preference still wins over a newer legacy row.

- [ ] **Step 2: Run to verify it fails**

cwd `packages/agent`: `cargo test --lib session --quiet` with your filter.

Note `mod wasm_ops` is `#[cfg(target_arch = "wasm32")]` and is NOT compiled natively. If the function cannot be unit-tested from the native target, say so plainly and cover it through the harness in Task 4 instead of inventing coverage — the same honesty the predecessor plan applied to this module.

- [ ] **Step 3: Drop the re-sort**

Replace the two `max_by_key` blocks with first-match scans over the already-ordered input, keeping the v1 preference. Document in the function why there is no sort: the order is the storage layer's guarantee, and re-sorting here would be the second sort order `SOVEREIGN_RECORD_ORDERING.md` forbids.

- [ ] **Step 4: Verify**

cwd `packages/agent`: `cargo test --lib session --quiet`, then `cargo check --target wasm32-wasip1 --quiet`.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/session/wasm_ops.rs
git commit -m "fix(session): the storage layer already ordered these, and it ordered them better"
```

---

### Task 4: Build, install, and prove on the node

**Files:** none — evidence.

- [ ] **Step 1: Build the component and the host**

```bash
pnpm --filter @refarm.dev/agent run build
cd packages/tractor && cargo build --release && cd -
pnpm --filter @refarm.dev/refarm run build
```

`pnpm --filter @refarm.dev/agent run build` — NOT a bare `cargo component build`, which does not republish `packages/agent/dist/agent.wasm`, the file `refarm plugin install` actually reads. That trap cost two agents a wrong diagnosis on 2026-08-05.

- [ ] **Step 2: Install and restart**

```bash
refarm plugin install
refarm runtime restart
refarm context
```

`refarm context` must show the loaded plugin hash equal to the built one. If it does not, stop — every measurement below would describe the wrong binary.

- [ ] **Step 3: Harness**

cwd `packages/tractor`: `cargo test --test agent_harness session -- --ignored --test-threads=1`

- [ ] **Step 4: Prove the session helper on the node**

```bash
refarm sessions list --json | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('active:', d.get('activeSessionId'), '| status:', d.get('activeSessionStatus'))
print('count:', len(d.get('sessions') or []))
"
refarm budget observations --limit 1 --json | python3 -c "
import sys,json,datetime
d=json.load(sys.stdin); o=d['observations']
print('newest:', datetime.datetime.fromtimestamp(o[0]['timestamp_ns']/1e9).isoformat())
print('stored:', d.get('stored'), '| truncated:', d.get('truncated'))
"
```

Expected: the active session resolves, and the observations reader still reports the newest record with its truncation facts — proving Tasks 1 and 3 did not regress the predecessor plan's fix.

- [ ] **Step 5: Gate and commit the evidence**

```bash
refarm agent finish --lane after-edit --run --json
git commit --allow-empty -m "test(graph): every consumer inherits the order, measured on the node"
```

---

### Task 5: Update the contract document

**Files:**
- Modify: `docs/SOVEREIGN_RECORD_ORDERING.md`

- [ ] **Step 1: Record what changed**

The document's affected-reader table lists nine call sites and marks which were fixed. Update it: the bridge and the session helper are now fixed, and say how each was fixed rather than only that it was.

- [ ] **Step 2: Record what is still deferred, precisely**

Two things remain and both deserve naming rather than silence:

- **The guest has no truncation signal.** `host.wit`'s `query-nodes` returns a bare `list<json-ld-node>`, so a plugin receiving exactly `limit` rows cannot tell whether more exist. Closing it means changing a contract every plugin implements, which is its own design.
- **There is no paging past `MAX_NODES_PER_RESPONSE`.** Rows beyond the ceiling are unreachable at any limit. The response now says it truncated, which is honest, but honesty is not access.

- [ ] **Step 3: Commit**

```bash
git add docs/SOVEREIGN_RECORD_ORDERING.md
git commit -m "docs(storage): two consumers fixed, two gaps named"
```

---

## Self-Review

| Requirement | Task |
| --- | --- |
| Bridge stops materialising whole tables | 1 |
| Client carries `stored` / `truncated`, absent stays absent | 2 |
| Session helper drops its second sort order | 3 |
| v1 preference preserved | 3 |
| One WASM rebuild, using the path that republishes `dist` | 4 |
| Proven on the node without regressing the predecessor's fix | 4 |
| `host.wit` untouched | no task modifies it |
| Deferred gaps named rather than silent | 5 |

**Type consistency:** `query_nodes_limited` is the predecessor's function, consumed in Task 1. `queryNodes`'s return type changes in Task 2 and every caller is updated in that same task. `latest_session_id_with_v1_preference` keeps its signature in Task 3.

**Known follow-up, deliberately out of scope:** the WIT truncation signal and paging, both recorded in Task 5.
