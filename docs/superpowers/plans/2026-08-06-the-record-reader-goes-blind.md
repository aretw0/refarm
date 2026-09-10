# The Record Reader Goes Blind — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `refarm budget observations` — and every other reader of the sovereign graph — return the newest records instead of the oldest, and stop truncating silently.

**Architecture:** One unordered `SELECT` is the root cause. Give it a deterministic newest-first order in SQL, push the limit down beside it so a reader stops loading the whole table, and make the API's hard ceiling report that it truncated instead of pretending it returned everything.

**Tech Stack:** Rust (`packages/tractor`, `cargo test --lib`), TypeScript (`apps/refarm`, vitest), plus a Mermaid diagram in `specs/diagrams/`.

## Global Constraints

- **Reproduced before planning, on the operator's own record of 29 observations:** `refarm budget observations --limit 1 --json` returns the observation from `2026-08-03T21:21:48` — the OLDEST — when the newest is `2026-08-05T17:29:36`. Any fix must be verified against that exact command flipping to the newest.
- **No silent caps.** `sidecar/mod.rs:1591` applies `.take(params.limit.min(100))`. A response that dropped records must say so; a reader cannot tell a complete answer from a truncated one today.
- **`currentRateTableFrom` is NOT broken and must not be "fixed".** It takes the maximum `timestamp_ns` across the nodes it is given (`budget.ts:199-211`) and is correct given its input. The defect is entirely upstream: the input is the oldest N. Changing that function would be fixing the wrong thing.
- **Rust build discipline (CLAUDE.md §7), non-negotiable:** there is NO root Cargo workspace, so every cargo command runs with cwd set to the crate directory. NEVER a bare `cargo test` — it compiles every test binary at once and can OOM the container. Use `cargo test --lib <filter> --quiet` or a named `--test`.
- **`query_nodes` has many callers** — `agent-bench`, `wasm_ops` (Session, UserPrompt, Response, UsageRecord), `policy.rs` (Task), `task_tools.rs` (Task, TaskEvent), the sidecar. A change to its ordering changes all of them, which is the point: every one of those `.take(n)` calls means "the n most recent" and none of them get that today.
- **Documentation and a diagram are deliverables, not follow-ups.** The operator asked for them explicitly: something this hard to find must be written down once it is right, or it gets rediscovered.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/tractor/src/storage/sqlite.rs:188-192` | The unordered SELECT. Gains a deterministic newest-first order. | 1 |
| `packages/tractor/src/storage/sqlite.rs:388+` | Its test module — ordering assertions. | 1 |
| `packages/tractor/src/sidecar/mod.rs:1588-1600` | The silent truncation. | 2 |
| `apps/refarm/src/commands/budget.ts` | Surface the truncation to the operator. | 2 |
| `docs/SOVEREIGN_RECORD_ORDERING.md` | **New.** The invariant, why it exists, and how it was found. | 4 |
| `specs/diagrams/record-read-path.mermaid` | **New.** The read path from SQL to the operator. | 4 |
| `specs/diagrams/INDEX.md` | Register the diagram in the catalog. | 4 |

---

### Task 1: The query stops returning whatever SQLite felt like

**Files:**
- Modify: `packages/tractor/src/storage/sqlite.rs:188-192`
- Test: `packages/tractor/src/storage/sqlite.rs` test module (starts line 388)

**Interfaces:**
- Consumes: nothing.
- Produces: `query_nodes(type_)` returns rows ordered newest-first, deterministically. Adds `query_nodes_limited(type_: &str, limit: usize) -> Result<Vec<NodeRow>>` applying the same order with `LIMIT` in SQL.

- [ ] **Step 1: Write the failing test**

Add to the test module in `packages/tractor/src/storage/sqlite.rs`:

```rust
#[test]
fn query_nodes_returns_newest_first() {
    let storage = test_storage();
    // Insert oldest first, so insertion order is the WRONG answer.
    storage.store_node("a", "Thing", None, r#"{"n":1}"#, None).unwrap();
    storage.store_node("b", "Thing", None, r#"{"n":2}"#, None).unwrap();
    storage.store_node("c", "Thing", None, r#"{"n":3}"#, None).unwrap();

    let rows = storage.query_nodes("Thing").unwrap();
    let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(
        ids[0], "c",
        "the newest row must come first: a reader taking N wants the N most recent, \
         and every caller in this repo does exactly that"
    );
}

#[test]
fn query_nodes_limited_takes_the_newest_n_not_the_oldest() {
    let storage = test_storage();
    storage.store_node("a", "Thing", None, r#"{"n":1}"#, None).unwrap();
    storage.store_node("b", "Thing", None, r#"{"n":2}"#, None).unwrap();
    storage.store_node("c", "Thing", None, r#"{"n":3}"#, None).unwrap();

    let rows = storage.query_nodes_limited("Thing", 1).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].id, "c",
        "limit 1 must be the NEWEST record. On the operator's own machine this returned the \
         oldest of 29 observations, so an audit with --limit 1 read the wrong record entirely."
    );
}

#[test]
fn query_nodes_order_is_total_so_equal_timestamps_do_not_shuffle() {
    let storage = test_storage();
    storage.store_node("a", "Thing", None, r#"{}"#, None).unwrap();
    storage.store_node("b", "Thing", None, r#"{}"#, None).unwrap();

    let first = storage.query_nodes("Thing").unwrap();
    let second = storage.query_nodes("Thing").unwrap();
    let ids = |rows: &Vec<NodeRow>| rows.iter().map(|r| r.id.clone()).collect::<Vec<_>>();
    assert_eq!(
        ids(&first),
        ids(&second),
        "rows written in the same clock tick must still come back in a stable order; \
         a partial order lets the answer change between two identical reads"
    );
}
```

If the existing test module has no `test_storage()` helper, follow whatever construction the tests at lines 395-443 already use and keep these consistent with it.

- [ ] **Step 2: Run the tests to verify they fail**

Run, with cwd `packages/tractor`: `cargo test --lib query_nodes --quiet`
Expected: FAIL — the newest-first assertions fail, and `query_nodes_limited` does not exist.

- [ ] **Step 3: Order the query and add the limited form**

Replace `query_nodes` (`packages/tractor/src/storage/sqlite.rs:188-192`) and add its sibling:

```rust
    /// Query nodes by `@type`, NEWEST FIRST.
    ///
    /// The ordering is not a nicety. Before 2026-08-06 this statement had no `ORDER BY` at
    /// all, so it returned rows in whatever order SQLite chose — in practice insertion
    /// order, oldest first. Every caller in this repository then took from the FRONT:
    /// `refarm budget observations` (`sidecar/mod.rs`), the WASM bridge
    /// (`host/wasi_bridge/core.rs`), `latest_session_id` and `latest_session_leaf_id`
    /// (`agent/src/session/wasm_ops.rs`). All of them meant "the most recent N" and all of
    /// them got the oldest N. Measured on the operator's node: `--limit 1` over 29
    /// observations returned the one from 2026-08-03, when the newest was from 2026-08-05.
    ///
    /// `id DESC` is the tiebreak, and it is load bearing: `updated_at` has second or
    /// millisecond granularity, so rows written in one tick would otherwise come back in an
    /// arbitrary order that could differ between two identical reads. A total order means a
    /// reader can page without records shifting underneath it.
    pub fn query_nodes(&self, type_: &str) -> Result<Vec<NodeRow>> {
        self.query_nodes_inner(type_, None)
    }

    /// Same order as {@link query_nodes}, with the limit applied IN SQL.
    ///
    /// Prefer this wherever a caller only wants the newest few: `query_nodes` materialises
    /// every row of that type before the caller discards most of them, which is affordable
    /// at 29 observations and is not at 29,000.
    pub fn query_nodes_limited(&self, type_: &str, limit: usize) -> Result<Vec<NodeRow>> {
        self.query_nodes_inner(type_, Some(limit))
    }

    fn query_nodes_inner(&self, type_: &str, limit: Option<usize>) -> Result<Vec<NodeRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = match limit {
            Some(_) => "SELECT id, type, context, payload, source_plugin, updated_at \
                        FROM nodes WHERE type = ?1 ORDER BY updated_at DESC, id DESC LIMIT ?2",
            None => "SELECT id, type, context, payload, source_plugin, updated_at \
                     FROM nodes WHERE type = ?1 ORDER BY updated_at DESC, id DESC",
        };
        let mut stmt = conn.prepare(sql).context("prepare query_nodes")?;

        let map_row = |row: &rusqlite::Row<'_>| {
            Ok(NodeRow {
                id: row.get(0)?,
                type_: row.get(1)?,
                context: row.get(2)?,
                payload: row.get(3)?,
                source_plugin: row.get(4)?,
                updated_at: row.get(5)?,
            })
        };

        let rows = match limit {
            Some(n) => stmt
                .query_map(params![type_, n as i64], map_row)
                .context("query_nodes")?
                .collect::<std::result::Result<Vec<_>, _>>(),
            None => stmt
                .query_map(params![type_], map_row)
                .context("query_nodes")?
                .collect::<std::result::Result<Vec<_>, _>>(),
        };
        rows.context("query_nodes rows")
    }
```

Keep the existing field names and the existing error-context strings; if the current body differs in how it collects rows, preserve that shape rather than rewriting it — the change under review is the ORDER BY and the limited sibling, nothing else.

- [ ] **Step 4: Run the tests to verify they pass**

Run, cwd `packages/tractor`: `cargo test --lib query_nodes --quiet`
Expected: PASS, 3 tests.

- [ ] **Step 5: Check nothing else depended on the old order**

Run, cwd `packages/tractor`: `cargo test --lib storage --quiet`
Then: `cargo check --quiet`
Expected: clean. If a test fails because it assumed insertion order, that test was encoding the defect — fix the test and say so in the report rather than weakening the ordering.

- [ ] **Step 6: Commit**

```bash
git add packages/tractor/src/storage/sqlite.rs
git commit -m "fix(storage): the record reader returned the oldest rows and called them the newest"
```

---

### Task 2: The ceiling stops lying

**Files:**
- Modify: `packages/tractor/src/sidecar/mod.rs:1588-1600`
- Modify: `apps/refarm/src/commands/budget.ts`
- Test: the sidecar's own test module, plus `apps/refarm/src/commands/budget.test.ts`

**Interfaces:**
- Consumes: `query_nodes_limited` from Task 1.
- Produces: the nodes endpoint's JSON gains `total` (how many exist of that type) and `truncated` (bool). `refarm budget observations` prints a line when `truncated` is true.

- [ ] **Step 1: Write the failing test**

In the sidecar's test module, assert that a request whose limit is below the number of stored nodes comes back with `truncated: true` and a `total` naming the real count, and that a request that covers everything reports `truncated: false`.

In `apps/refarm/src/commands/budget.test.ts`, assert that the human output includes a truncation notice when the payload says `truncated: true`, and does not when it says false. Drive it with a literal payload — no network.

- [ ] **Step 2: Run them to verify they fail**

cwd `packages/tractor`: `cargo test --lib nodes_endpoint --quiet` (adjust the filter to the test names you wrote)
and `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/budget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `sidecar/mod.rs`, replace the `query_nodes(...)` + `.take(params.limit.min(100))` pair with `query_nodes_limited(type_, effective_limit)`, where `effective_limit = params.limit.min(MAX_NODES_PER_RESPONSE)`. Keep the ceiling — an unbounded response is its own hazard — but compute the true total and report both:

```rust
/// The most nodes one response will carry. A ceiling is right; a SILENT ceiling is not,
/// which is why `total` and `truncated` travel beside the rows. Before 2026-08-06 this cap
/// was applied to an unordered query, so past 100 records of a type the API could never
/// surface a recent one at any `limit` the caller asked for.
const MAX_NODES_PER_RESPONSE: usize = 100;
```

In `budget.ts`, when the payload reports `truncated`, print a line naming how many were returned out of how many exist and how to see more. Follow the file's existing output style.

- [ ] **Step 4: Verify**

cwd `packages/tractor`: `cargo test --lib nodes --quiet` and `cargo check --quiet`
Then: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/budget.test.ts` and `pnpm --filter @refarm.dev/refarm run type-check`

- [ ] **Step 5: Commit**

```bash
git add packages/tractor/src/sidecar/mod.rs apps/refarm/src/commands/budget.ts apps/refarm/src/commands/budget.test.ts
git commit -m "fix(budget): a truncated answer now says it was truncated"
```

---

### Task 3: Prove it on the operator's own record

**Files:** none — this task produces evidence.

- [ ] **Step 1: Build and restart**

```bash
cd packages/tractor && cargo build --release && cd -
pnpm --filter @refarm.dev/refarm run build
refarm runtime restart
refarm context
```

`refarm context` must show the loaded plugin hash matching the built one; if it does not, stop, because every measurement below would be about the wrong binary.

- [ ] **Step 2: The reproduction, inverted**

```bash
refarm budget observations --limit 1 --json | python3 -c "
import sys,json,datetime
o=json.load(sys.stdin)['observations']
print('limit 1 ->', datetime.datetime.fromtimestamp(o[0]['timestamp_ns']/1e9).isoformat())
"
refarm budget observations --limit 500 --json | python3 -c "
import sys,json,datetime
o=json.load(sys.stdin)['observations']
f=lambda x: datetime.datetime.fromtimestamp(x['timestamp_ns']/1e9).isoformat()
print('total:', len(o), '| first:', f(o[0]), '| last:', f(o[-1]))
"
```

Expected: `--limit 1` now returns the NEWEST observation. Before this plan it returned `2026-08-03T21:21:48` out of 29 records whose newest was `2026-08-05T17:29:36`. Paste both outputs.

- [ ] **Step 3: Re-run the coverage audit**

```bash
refarm budget observations --limit 500 --json | python3 -c "
import sys,json,collections
obs=json.load(sys.stdin)['observations']
n=len(obs)
for a in ['refarm.workspace.id','refarm.scenario.id','host.name','refarm.verification.passed']:
    print(f'{a:32s}', sum(1 for o in obs if o.get(a) is not None), '/', n)
"
```

- [ ] **Step 4: Run the gate and commit the evidence**

```bash
refarm agent finish --lane after-edit --run --json
git commit --allow-empty -m "test(storage): limit 1 is the newest record now, measured on the node"
```

---

### Task 4: Write it down, because finding it cost more than fixing it

The operator asked for this explicitly: something this hard to find must be documented once it is right, or the next person researches it from zero.

**Files:**
- Create: `docs/SOVEREIGN_RECORD_ORDERING.md`
- Create: `specs/diagrams/record-read-path.mermaid`
- Modify: `specs/diagrams/INDEX.md`

- [ ] **Step 1: Write the document**

`docs/SOVEREIGN_RECORD_ORDERING.md` must state:

- **The invariant.** `query_nodes` returns newest first, with `id DESC` as a total-order tiebreak. Every caller that takes N means the N most recent.
- **Why it exists**, with the measurement: an unordered `SELECT` plus five readers taking from the front, so `--limit 1` over 29 observations returned the one from 2026-08-03 while the newest was from 2026-08-05.
- **How it was found**, because that is the part worth reusing: not by reading the SQL, but by a whole-plan review tracing why a cost audit could not see recent records. The SQL had looked fine to everyone who read it.
- **What a caller must do:** prefer `query_nodes_limited` when only the newest few are wanted, and never re-sort in the caller — two sort orders are how two answers drift apart.
- **What a response means now:** `total` and `truncated` accompany the rows, and a ceiling is allowed while a silent one is not.

- [ ] **Step 2: Draw the read path**

`specs/diagrams/record-read-path.mermaid`: SQLite `nodes` table → `query_nodes` / `query_nodes_limited` (ORDER BY updated_at DESC, id DESC) → the three readers (sidecar HTTP nodes endpoint with its ceiling, the WASM bridge, the agent's session helpers) → `refarm budget observations`. Mark on the diagram where the ordering guarantee is established and where the truncation ceiling applies.

Read `specs/diagrams/DESIGN_SYSTEM.md` first and follow the global config — do not hand-style it.

- [ ] **Step 3: Register and render**

Add the diagram to the catalog table in `specs/diagrams/INDEX.md` beside the existing entries, then:

```bash
pnpm run diagrams:fix
pnpm run diagrams:check
```

Expected: the SVG is generated and the check passes with no drift.

- [ ] **Step 4: Commit**

```bash
git add docs/SOVEREIGN_RECORD_ORDERING.md specs/diagrams/record-read-path.mermaid specs/diagrams/record-read-path.svg specs/diagrams/INDEX.md
git commit -m "docs(storage): the ordering invariant, and how a cost audit found it"
```

---

## Self-Review

**Spec coverage:** this plan has no separate spec — the defect was measured and reproduced, and the fix is not a design question. The reproduction is recorded in the Global Constraints and is the acceptance test in Task 3.

| Requirement | Task |
| --- | --- |
| Deterministic newest-first order | 1 |
| A total order, so identical reads agree | 1 |
| Limit pushed into SQL | 1 |
| The ceiling stops truncating silently | 2 |
| Proven on the operator's real record | 3 |
| Documentation | 4 |
| Diagram in the project's library | 4 |
| `currentRateTableFrom` deliberately untouched | no task modifies it |

**Type consistency:** `query_nodes_limited` is defined in Task 1 and consumed under that name in Task 2. `NodeRow`'s fields are unchanged throughout. `MAX_NODES_PER_RESPONSE` is introduced in Task 2 and used only there.

**Known follow-up, out of scope:** `latest_session_id_with_v1_preference(20)` and `latest_session_leaf_id(10)` in `agent/src/session/wasm_ops.rs` become correct as a consequence of Task 1, since taking N of a newest-first result is now the newest N. They are not modified here, and no task rebuilds the WASM component — the ordering fix lives entirely in the host.
