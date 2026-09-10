# Budget Laboratory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dispatch declare its own budget, resolved through nested node and workspace
ceilings, and make every run leave a durable record of the budget that governed it and the outcome
it reached.

**Architecture:** Three axes (deadline, tokens, cost) declared per dispatch and resolved by a fold
over three levels (node ⊇ workspace ⊇ declared), adopting Kubernetes' ResourceQuota/LimitRange
structure. Every terminal effort writes a `BudgetObservation` node into the CRDT store beside the
`UsageRecord` it joins to, with no TTL. Before any of that, the cost accounting underneath is
corrected, because a laboratory built on a wrong estimator measures wrong from day one.

**Tech Stack:** Rust (`packages/tractor`, `packages/agent`), TypeScript (`packages/budget-contract-v1`,
`apps/refarm`), vitest for TS, `cargo test --lib` for Rust, SQLite-backed CRDT node store.

**Spec:** [`docs/superpowers/specs/2026-08-03-budget-laboratory-design.md`](../specs/2026-08-03-budget-laboratory-design.md)

## Scope

This plan covers **spec slices 1–5**, in thirteen tasks. After Task 13, every real run the operator
makes from any surface is evidence, the declared ceilings actually bind, and a spawner can declare
them from the surface the operator actually types.

**Tasks 7, 8 and 9 were added on 2026-08-03, mid-execution**, and the reasons are recorded because
they change what the plan is:

- The maintainer asked how cost accounting stays current with a moving market. Measuring the answer
  found the drift had **already happened**: the rate table's Claude branches stop at the 4 family, so
  every Claude 5 model falls through to the return value meaning "local model, genuinely free".
  Tasks 7 and 8 separate *unknown* from *free*, name the rate table with a version, and teach the
  existing model-drift gate to require a price. Task 10 stamps that version on every observation and
  Task 11 counts the records a later correction would need to revisit — because **tokens do not
  drift and prices do**, so the record stores what is stable and lets the volatile part be recomputed.
- Task 9 closes an omission in this plan: Task 5 built the three-level fold and its only production
  caller passes `None` for the workspace level, so D9's middle level was unreachable outside tests.
- Task 12 was added after Task 6 reported its own guards inert: nothing carries the resolved ceiling
  from the node to the WASM guest, and the total at the call site is per-turn rather than cumulative,
  so F6's actual finding stays open. Declarable-but-unenforced is the shape D1 refused for `maxUsd`;
  the same rule has to hold for the two axes that CAN bind.

**Spec slices 6–8 (the sweep, the gallery, closing the loop) get their own plan.** The spec draws
that seam itself: 1–5 make the instrument record; 6–8 make it reproducible by third parties. Writing
them as one document would produce a plan too large to execute or review, and each half is
independently valuable. This is a decomposition of the approved order, not a reduction of it.

## Global Constraints

- **Source sovereignty**: edit `src/` only. Never `dist/`, `target/`, `.turbo/` (CLAUDE.md §1).
- **Rust build discipline**: this host has ~8GB RAM. Use `cargo test --lib <filter> --quiet` or
  `cargo test --test <suite>`. **Never bare `cargo test`** — it compiles all test binaries at once
  and OOMs the container (CLAUDE.md §7).
- **Protected surface**: `packages/tractor/**` follows serialized lock/handoff policy (CLAUDE.md §8).
  The maintainer authorised it for this program. Do not widen beyond the files named per task.
- **Known flaky**: `observer::tests::rotate_seals_the_full_file_and_starts_fresh` fails ~2 of 4 under
  parallel `cargo test --lib` and never under `--test-threads=1`. It is unrelated to this work. If it
  fails, re-run with `--test-threads=1` before investigating.
- **`cargo check --lib` does not compile `#[cfg(test)]` code.** Found the hard way in Task 1: a type
  change that `cargo check` calls clean can still break test modules the change never named. When a
  task widens a type, the site list is a starting point and `cargo test --lib --quiet` is the only
  command that proves it complete.
- **Scoped commands**: `pnpm --filter @refarm.dev/<pkg> run <script>`, never `cd` into packages.
- **After source edits, before committing**: `refarm agent finish --lane after-edit --run --json`.
- **After each commit**: `refarm agent finish --lane after-commit --run --json`.
- **Cache write multiplier**: `1.25` (Anthropic 5-minute cache, the API default). The 1-hour cache is
  `2.0`, but the TTL is not recoverable from the usage payload alone, so `1.25` is the documented
  floor and the comment must say so.
- **Cache read multiplier**: `0.1`.

## File Structure

**Task 1–3 (the accounting correction), `packages/agent/src/`:**

| File | Responsibility after the change |
| --- | --- |
| `provider_runtime/usage_totals.rs` | Parses each provider's accounting model into two distinct cache fields |
| `provider.rs` | `CompletionResult` carries `cache_read_tokens` and `cache_creation_tokens` |
| `runtime/types.rs` | `ReactResult` tuple gains one element |
| `utils.rs` | The estimator applies each provider's input-accounting rule |
| `response_nodes.rs` | `UsageRecord` node emits both fields under OTel-aligned names |

**Task 4 (the contract), `packages/budget-contract-v1/src/`:**

| File | Responsibility |
| --- | --- |
| `types.ts` | The three-axis declaration, the ceiling, the resolved shape |
| `resolve.ts` | The D9 fold — pure, no IO, the single source of resolution truth |
| `conformance.ts` | The suite any implementation must pass |
| `index.ts` | Public surface |

**Task 5–8 (the wiring), `packages/tractor/src/sidecar/`:**

| File | Responsibility |
| --- | --- |
| `budget.rs` (new) | Rust mirror of the D9 fold, and the resolved budget carried per effort |
| `dispatch.rs` | Reads the declared budget off the effort; the watcher uses the resolved deadline |
| `observation.rs` (new) | Builds and writes the `BudgetObservation` node |

`dispatch.rs` is already 800+ lines. New behaviour goes in `budget.rs` and `observation.rs`, and
`dispatch.rs` gains call sites only.

---

### Task 1: Split cache accounting through the agent type chain

Pure plumbing. **No behaviour change** — the estimator keeps receiving the same total, passed as
`cache_read + cache_creation`, so every existing test still passes. Task 2 changes behaviour.

**Files:**
- Modify: `packages/agent/src/provider_runtime/usage_totals.rs:1-32`
- Modify: `packages/agent/src/provider.rs:6-15`
- Modify: `packages/agent/src/provider_runtime/usage_finalize.rs:11-19`
- Modify: `packages/agent/src/runtime/types.rs:1-10`
- Modify: `packages/agent/src/response_nodes.rs:13-23`
- Test: `packages/agent/src/tests/provider_runtime_tests/usage_phase.rs`

**Interfaces:**
- Produces: `UsageTotals { tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, tokens_reasoning }`;
  `CompletionResult` with the same two cache fields; `ReactResult` as a 9-element tuple ordered
  `(content, tool_calls, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, tokens_reasoning, model_id, usage_raw)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent/src/tests/provider_runtime_tests/usage_phase.rs`:

```rust
#[test]
fn anthropic_usage_keeps_reads_and_writes_apart() {
    let mut totals = UsageTotals::default();
    totals.ingest_anthropic_usage(&serde_json::json!({
        "input_tokens": 50,
        "output_tokens": 10,
        "cache_read_input_tokens": 100_000,
        "cache_creation_input_tokens": 2_048,
    }));
    assert_eq!(totals.tokens_in, 50, "input_tokens excludes both cache buckets");
    assert_eq!(totals.cache_read_tokens, 100_000);
    assert_eq!(totals.cache_creation_tokens, 2_048);
}

#[test]
fn openai_usage_reports_reads_only_and_never_invents_writes() {
    let mut totals = UsageTotals::default();
    totals.ingest_openai_usage(&serde_json::json!({
        "prompt_tokens": 1_000,
        "completion_tokens": 200,
        "prompt_tokens_details": { "cached_tokens": 800 },
    }));
    assert_eq!(totals.tokens_in, 1_000, "prompt_tokens INCLUDES cached reads");
    assert_eq!(totals.cache_read_tokens, 800);
    assert_eq!(
        totals.cache_creation_tokens, 0,
        "OpenAI reports no cache-write token count; inventing one would bill a surcharge that does not exist"
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --lib usage_phase --quiet`
Expected: FAIL — `no field cache_read_tokens on type UsageTotals`

- [ ] **Step 3: Rewrite `UsageTotals`**

Replace `packages/agent/src/provider_runtime/usage_totals.rs:1-32` with:

```rust
#[derive(Default)]
pub(crate) struct UsageTotals {
    pub tokens_in: u32,
    pub tokens_out: u32,
    /// Input tokens served FROM the provider's cache. Billed at a discount.
    /// OTel: gen_ai.usage.cache_read.input_tokens
    pub cache_read_tokens: u32,
    /// Input tokens WRITTEN INTO the provider's cache. Billed at a SURCHARGE.
    /// Kept apart from reads because the two are priced in opposite directions;
    /// summing them made every cache write look like a discount.
    /// OTel: gen_ai.usage.cache_creation.input_tokens
    pub cache_creation_tokens: u32,
    pub tokens_reasoning: u32,
}

impl UsageTotals {
    /// Anthropic's accounting model: `input_tokens` EXCLUDES both cache buckets
    /// (it is the tokens after the last cache breakpoint). Total input processed
    /// is the sum of all three.
    pub(crate) fn ingest_anthropic_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["input_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["output_tokens"].as_u64().unwrap_or(0) as u32;
        self.cache_read_tokens += usage["cache_read_input_tokens"].as_u64().unwrap_or(0) as u32;
        self.cache_creation_tokens +=
            usage["cache_creation_input_tokens"].as_u64().unwrap_or(0) as u32;
    }

    /// OpenAI's accounting model: `prompt_tokens` INCLUDES cached reads, and there
    /// is no cache-write token count because caching is automatic and carries no
    /// write surcharge. `cache_creation_tokens` stays zero here BY DESIGN.
    pub(crate) fn ingest_openai_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage_u32(usage, &["prompt_tokens", "input_tokens"]);
        self.tokens_out += usage_u32(usage, &["completion_tokens", "output_tokens"]);
        self.cache_read_tokens += nested_usage_u32(
            usage,
            &["prompt_tokens_details", "input_tokens_details"],
            "cached_tokens",
        );
        self.tokens_reasoning += nested_usage_u32(
            usage,
            &["completion_tokens_details", "output_tokens_details"],
            "reasoning_tokens",
        );
    }
}
```

Leave `usage_u32` and `nested_usage_u32` below it untouched.

- [ ] **Step 4: Widen `CompletionResult`**

In `packages/agent/src/provider.rs:6-15`, replace the `tokens_cached: u32,` field with:

```rust
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
```

- [ ] **Step 5: Widen `ReactResult`**

In `packages/agent/src/runtime/types.rs:1-10`, the tuple gains one `u32`:

```rust
/// (content, tool_calls, tokens_in, tokens_out, cache_read_tokens,
///  cache_creation_tokens, tokens_reasoning, model_id, usage_raw)
pub(crate) type ReactResult = (
    String,
    serde_json::Value,
    u32,
    u32,
    u32,
    u32,
    u32,
    String,
    String,
);
```

`blocked_result` and `error_result` in the same file each gain one more `0,` in their tuple
literal, in the same position.

- [ ] **Step 6: Let the compiler name every remaining site**

Run: `cargo check --lib --quiet 2>&1 | grep -E "^error" | head -40`

Fix each named site by the mechanical rule: **one `tokens_cached` becomes two fields, and every
destructuring of `ReactResult` gains one `_` or binding in position 6.** These sites are known in
advance — the compiler is the checklist, not the discovery mechanism:

| File | What changes |
| --- | --- |
| `provider_runtime/usage_finalize.rs:16` | `tokens_cached: totals.tokens_cached` → the two fields from `totals` |
| `runtime/streaming_metadata.rs:8,32` | field and forwarding call |
| `runtime/prompt_persistence.rs:38,285` | `UsageRecordInput` field and its construction |
| `runtime/prompt_handler.rs:22` | local field |
| `runtime/react_loop.rs:7` | the doc comment above `react` must state the new 9-element order |
| `lib.rs:371,399,406` | destructuring and the `estimate_billable_usd` call — pass `cache_read + cache_creation` for now, Task 2 changes the signature |
| `response_nodes.rs:19` | `UsageRecordPayload` gains both fields; Task 3 changes what the node emits |
| `extensibility_contract.rs:37` | add one `_` |
| `tests/runtime_response_schema_tests.rs:14,37` | add one binding each |
| `tests/runtime_cost_guard_tests.rs:6` | add one `_` |
| `tests/usage_record_schema_tests.rs:6` | add one binding |
| `tests/system_prompt_tests.rs:15` | add one `_` |

- [ ] **Step 7: Run the tests**

Run: `cargo test --lib usage_phase --quiet && cargo test --lib --quiet`
Expected: PASS. If `observer::tests::rotate_seals_the_full_file_and_starts_fresh` fails, re-run with
`--test-threads=1` (see Global Constraints).

- [ ] **Step 8: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/agent/src
git commit -m "refactor(agent): cache reads and cache writes stop sharing one number

Anthropic reports them separately and prices them in opposite directions.
Plumbing only: the estimator still receives the sum, so behaviour is unchanged
and every existing assertion still holds. The pricing fix follows."
refarm agent finish --lane after-commit --run --json
```

---

### Task 2: Honour each provider's accounting model in the estimate

This is the F5 fix. **It changes an existing test on purpose** — `estimate_usd_sonnet_with_cache_discount`
currently asserts OpenAI's subset model against a Claude model id, which is the defect.

**Files:**
- Modify: `packages/agent/src/utils.rs:12-68`
- Modify: `packages/agent/src/lib.rs:406`
- Test: `packages/agent/src/tests/runtime_cost_guard_tests.rs:17-35`

**Interfaces:**
- Consumes: Task 1's `cache_read_tokens` / `cache_creation_tokens`.
- Produces: `estimate_billable_usd(provider, model, tokens_in, tokens_out, cache_read, cache_creation) -> f64`
  and `estimate_usd(provider, model, tokens_in, tokens_out, cache_read, cache_creation) -> f64`.
  Both gain `provider` as the first parameter — `estimate_usd` needs it to pick the accounting model.

- [ ] **Step 1: Write the failing tests**

Replace `estimate_usd_sonnet_with_cache_discount` in
`packages/agent/src/tests/runtime_cost_guard_tests.rs` with these four. The vector in the first is
copied verbatim from Anthropic's prompt-caching documentation.

```rust
#[test]
fn anthropic_uncached_input_is_not_swallowed_by_a_large_cache_read() {
    // Anthropic's own documented example: 100k read, 0 written, 50 after the
    // breakpoint. The 50 are genuinely uncached and must be billed at full rate.
    // The old code did tokens_in.saturating_sub(cached) = 50 - 100_000 = 0 and
    // billed them at nothing.
    let cost = estimate_usd("anthropic", "claude-sonnet-4-6", 50, 0, 100_000, 0);
    let expected = (50.0 / 1_000_000.0) * 3.0 + (100_000.0 / 1_000_000.0) * 3.0 * 0.1;
    assert!(
        (cost - expected).abs() < 1e-12,
        "expected {expected}, got {cost}"
    );
}

#[test]
fn anthropic_cache_writes_cost_more_than_input_not_less() {
    // A cache write is billed at 1.25x base input on the 5-minute cache, not at
    // the 0.1x read discount. Same token count, opposite direction.
    let write_cost = estimate_usd("anthropic", "claude-sonnet-4-6", 0, 0, 0, 10_000);
    let read_cost = estimate_usd("anthropic", "claude-sonnet-4-6", 0, 0, 10_000, 0);
    assert!(
        write_cost > read_cost * 12.0,
        "a write must not be priced like a read: write={write_cost} read={read_cost}"
    );
    let expected = (10_000.0 / 1_000_000.0) * 3.0 * 1.25;
    assert!((write_cost - expected).abs() < 1e-12);
}

#[test]
fn openai_cached_tokens_remain_a_subset_of_prompt_tokens() {
    // Unchanged behaviour for the subset model: 1000 prompt tokens of which 200
    // were cache reads bills 800 at full rate.
    let cost = estimate_usd("openai", "gpt-5.5", 1_000, 500, 200, 0);
    let expected = (800.0 / 1_000_000.0) * 5.0
        + (200.0 / 1_000_000.0) * 5.0 * 0.1
        + (500.0 / 1_000_000.0) * 30.0;
    assert!((cost - expected).abs() < 1e-12, "expected {expected}, got {cost}");
}

#[test]
fn subscription_and_local_pricing_modes_stay_at_zero() {
    // openai-codex is a subscription; ollama is local. A currency figure over
    // either is meaningless, and D1 depends on this staying true.
    assert_eq!(
        estimate_billable_usd("openai-codex", "gpt-5.5", 10_000, 5_000, 1_000, 500),
        0.0
    );
    assert_eq!(
        estimate_billable_usd("ollama", "llama3", 10_000, 5_000, 0, 0),
        0.0
    );
}
```

Also update `estimate_usd_sonnet_no_cache` in the same file to the new signature:

```rust
    let cost = estimate_usd("anthropic", "claude-sonnet-4-6", 1000, 500, 0, 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib runtime_cost_guard --quiet`
Expected: FAIL — `estimate_usd` takes 4 arguments but 6 were supplied.

- [ ] **Step 3: Implement the accounting split**

In `packages/agent/src/utils.rs`, add above `estimate_billable_usd`:

```rust
/// Anthropic bills a 5-minute cache write at 1.25x base input and a 1-hour write
/// at 2x. The usage payload does not say which TTL was used, so this is the
/// documented FLOOR: a 1-hour write is under-counted, never over-counted.
const CACHE_WRITE_MULTIPLIER: f64 = 1.25;
/// Cache reads bill at 10% of base input on both providers.
const CACHE_READ_MULTIPLIER: f64 = 0.1;

/// How a provider reports input tokens relative to its cache buckets.
pub(crate) enum InputAccounting {
    /// `input_tokens` EXCLUDES the cache buckets; total input is the sum of all
    /// three. (Anthropic)
    Disjoint,
    /// `prompt_tokens` INCLUDES cache reads; subtract them to get full-rate
    /// input. (OpenAI and every openai-compatible provider)
    Subset,
}

pub(crate) fn input_accounting_for_provider(provider: &str) -> InputAccounting {
    match provider.trim().to_ascii_lowercase().as_str() {
        "anthropic" => InputAccounting::Disjoint,
        _ => InputAccounting::Subset,
    }
}
```

Then replace the two estimator functions:

```rust
pub(crate) fn estimate_billable_usd(
    provider: &str,
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
    cache_read: u32,
    cache_creation: u32,
) -> f64 {
    if pricing_mode_for_provider(provider) != "api" {
        return 0.0;
    }
    estimate_usd(provider, model, tokens_in, tokens_out, cache_read, cache_creation)
}

/// Estimate API cost in USD using public per-million-token rates.
/// Returns 0.0 for local/unknown models — sovereign infra is free.
pub(crate) fn estimate_usd(
    provider: &str,
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
    cache_read: u32,
    cache_creation: u32,
) -> f64 {
    let (rate_in, rate_out): (f64, f64) = if model.contains("claude-opus-4") {
        (15.0, 75.0)
    } else if model.contains("claude-sonnet-4") || model.contains("claude-sonnet-3-7") {
        (3.0, 15.0)
    } else if model.contains("claude-haiku") {
        (0.8, 4.0)
    } else if model.contains("gpt-5.5") {
        (5.0, 30.0)
    } else if model.contains("gpt-5-mini") || model.contains("gpt-5.1-codex-mini") {
        (0.25, 2.0)
    } else if model.contains("gpt-5-nano") {
        (0.05, 0.4)
    } else if model.contains("gpt-5") {
        (1.25, 10.0)
    } else if model.contains("gpt-4o") && !model.contains("mini") {
        (2.5, 10.0)
    } else if model.contains("gpt-4o-mini") {
        (0.15, 0.6)
    } else {
        return 0.0; // ollama, llama*, local models — free
    };

    // The full-rate share depends on whether the provider counts cache reads
    // inside tokens_in or beside it. Getting this backwards is the F5 defect.
    let full_rate_input = match input_accounting_for_provider(provider) {
        InputAccounting::Disjoint => tokens_in as f64,
        InputAccounting::Subset => tokens_in.saturating_sub(cache_read) as f64,
    };

    (full_rate_input / 1_000_000.0) * rate_in
        + (cache_read as f64 / 1_000_000.0) * rate_in * CACHE_READ_MULTIPLIER
        + (cache_creation as f64 / 1_000_000.0) * rate_in * CACHE_WRITE_MULTIPLIER
        + (tokens_out as f64 / 1_000_000.0) * rate_out
}
```

- [ ] **Step 4: Update the one production call site**

`packages/agent/src/lib.rs:406` and `packages/agent/src/response_nodes.rs:63` both call
`estimate_billable_usd`. Pass `cache_read` and `cache_creation` separately instead of the sum Task 1
left there.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib runtime_cost_guard --quiet && cargo test --lib --quiet`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/agent/src
git commit -m "fix(agent): price each provider's accounting model, not one of them twice

Anthropic's input_tokens excludes the cache buckets, so subtracting the cache
from it billed genuinely uncached input at zero whenever the cache was large —
which is the normal case. And a cache write was priced at the 0.1x read discount
when it costs 1.25x base input.

The test that asserted 1000 input with 200 cached bills 800 at full rate was
pinning the subset model against a Claude id. It now pins the rule per provider,
with vectors taken from the vendors' own documentation."
refarm agent finish --lane after-commit --run --json
```

---

### Task 3: Emit the split on the UsageRecord node and its reader

**Files:**
- Modify: `packages/agent/src/response_nodes.rs:53-70`
- Modify: `packages/tractor/src/sidecar/dispatch.rs:649-669` (protected surface)
- Test: `packages/agent/src/tests/usage_record_schema_tests.rs`

**Interfaces:**
- Produces: `UsageRecord` nodes carrying `cache_read_input_tokens` and `cache_creation_input_tokens`
  alongside the retained `tokens_cached` sum.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent/src/tests/usage_record_schema_tests.rs`:

```rust
#[test]
fn usage_record_carries_both_cache_buckets_and_their_sum() {
    let node = usage_record_node(UsageRecordPayload {
        prompt_ref: "urn:sovereign:prompt-test",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        tokens_in: 50,
        tokens_out: 10,
        cache_read_tokens: 100_000,
        cache_creation_tokens: 2_048,
        tokens_reasoning: 0,
        usage_raw: "{}",
        duration_ms: 0,
    });
    assert_eq!(node["cache_read_input_tokens"], 100_000);
    assert_eq!(node["cache_creation_input_tokens"], 2_048);
    assert_eq!(
        node["tokens_cached"], 102_048,
        "the sum stays for readers that predate the split"
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --lib usage_record_schema --quiet`
Expected: FAIL — `node["cache_read_input_tokens"]` is `Null`.

- [ ] **Step 3: Emit both fields**

In `packages/agent/src/response_nodes.rs`, inside `usage_record_node`, replace the
`"tokens_cached": payload.tokens_cached,` line with:

```rust
        // OTel gen_ai.usage.cache_read.input_tokens / cache_creation.input_tokens,
        // spelled flat because this node is not an OTel span.
        "cache_read_input_tokens":     payload.cache_read_tokens,
        "cache_creation_input_tokens": payload.cache_creation_tokens,
        // Retained for readers written before the split. Derived, never authoritative.
        "tokens_cached": payload.cache_read_tokens + payload.cache_creation_tokens,
```

and pass both fields to `estimate_billable_usd` on the line above.

- [ ] **Step 4: Surface the split in the sidecar's usage view**

In `packages/tractor/src/sidecar/dispatch.rs`, inside `usage_view_from_record`, add to the `"usage"`
object after `"tokens_cached": count("tokens_cached"),`:

```rust
            "cache_read_input_tokens": count("cache_read_input_tokens"),
            "cache_creation_input_tokens": count("cache_creation_input_tokens"),
```

`count` already defaults a missing key to `0`, which is correct here: a record written before this
change genuinely had no split to report, and D6's "absent is not zero" applies to the observation
node of Task 7, not to a back-compat view.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib usage_record_schema --quiet && cargo test --lib --quiet`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/agent/src packages/tractor/src
git commit -m "feat(agent): the usage record states both cache buckets, in OTel's vocabulary

tokens_cached stays as their sum so readers that predate the split keep working,
but it is derived now and never the source."
refarm agent finish --lane after-commit --run --json
```

---

### Task 4: `packages/budget-contract-v1` — three axes and the nested fold

**Files:**
- Create: `packages/budget-contract-v1/package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `vitest.config.ts`, `README.md`, `eslint.config.js`
- Create: `packages/budget-contract-v1/src/{types.ts,resolve.ts,resolve.test.ts,conformance.ts,conformance.test.ts,index.ts}`
- Modify: `scripts/ci/subprocess-utils.mjs:6` (TASK_SMOKE_TS_BUILD_ORDER)
- Modify: `scripts/ci/gate-smoke-contracts.mjs:10`

**Interfaces:**
- Produces: `resolveBudget(input: BudgetResolutionInput): ResolvedBudget`, and the types below.
  Task 5's Rust mirror must agree with this function's behaviour exactly.

Copy the scaffold from `packages/effort-contract-v1` — same `package.json` script set, same
`devDependencies` (`@refarm.dev/eslint-config`, `@refarm.dev/tsconfig`, `@refarm.dev/vtconfig`), same
`files`/`exports` block, with name `@refarm.dev/budget-contract-v1` and description
`Versioned budget capability contract (budget:v1) and conformance suite`.

- [ ] **Step 1: Write `types.ts`**

```ts
/** The contract version this package implements. */
export const BUDGET_CONTRACT_VERSION = "budget:v1";

/** The three axes a spawner may declare. Every field is optional; an omitted
 *  axis falls back to the workspace default, then the node default. */
export type BudgetDeclaration = {
	/** Wall-clock deadline for the whole dispatch. */
	deadlineMs?: number;
	/** Cumulative tokens across the dispatch, not per call. */
	maxTokens?: number;
	/** Estimated spend. Only binds under `api` pricing mode. */
	maxUsd?: number;
};

/** A ceiling has the same shape as a declaration; it is read as a maximum. */
export type BudgetCeiling = BudgetDeclaration;

export type BudgetAxis = "deadlineMs" | "maxTokens" | "maxUsd";

export const BUDGET_AXES: readonly BudgetAxis[] = [
	"deadlineMs",
	"maxTokens",
	"maxUsd",
];

/** Which level produced the effective value. */
export type BudgetLevel = "node" | "workspace" | "declared" | "default";

export type ResolvedAxis = {
	/** The value that will actually govern the run. */
	effective: number;
	/** What the spawner asked for, or null if it asked for nothing. */
	declared: number | null;
	/** Which level produced `effective`. Never inferred by the reader. */
	boundBy: BudgetLevel;
};

export type ResolvedBudget = Record<BudgetAxis, ResolvedAxis>;

/** The node always has a complete default and a complete ceiling: it is the
 *  machine, and it always knows what it can serve. A workspace may declare
 *  either, both, or neither. */
export type BudgetResolutionInput = {
	declared?: BudgetDeclaration;
	workspace?: { ceiling?: BudgetCeiling; default?: BudgetDeclaration };
	node: { ceiling: Required<BudgetCeiling>; default: Required<BudgetDeclaration> };
};
```

- [ ] **Step 2: Write the failing resolution tests**

`packages/budget-contract-v1/src/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveBudget } from "./resolve.js";

const node = {
	ceiling: { deadlineMs: 600_000, maxTokens: 500_000, maxUsd: 10 },
	default: { deadlineMs: 45_000, maxTokens: 100_000, maxUsd: 1 },
};

describe("resolveBudget", () => {
	it("uses the node default when nobody declares anything", () => {
		const resolved = resolveBudget({ node });
		expect(resolved.deadlineMs).toEqual({
			effective: 45_000,
			declared: null,
			boundBy: "default",
		});
	});

	it("lets the spawner declare above the default and below the ceiling", () => {
		const resolved = resolveBudget({ node, declared: { deadlineMs: 300_000 } });
		expect(resolved.deadlineMs).toEqual({
			effective: 300_000,
			declared: 300_000,
			boundBy: "declared",
		});
	});

	it("clamps to the node ceiling and says the node did it", () => {
		const resolved = resolveBudget({ node, declared: { deadlineMs: 9_000_000 } });
		expect(resolved.deadlineMs).toEqual({
			effective: 600_000,
			declared: 9_000_000,
			boundBy: "node",
		});
	});

	it("clamps to a tighter workspace ceiling and says the workspace did it", () => {
		const resolved = resolveBudget({
			node,
			workspace: { ceiling: { deadlineMs: 120_000 } },
			declared: { deadlineMs: 300_000 },
		});
		expect(resolved.deadlineMs).toEqual({
			effective: 120_000,
			declared: 300_000,
			boundBy: "workspace",
		});
	});

	it("refuses to let a workspace grant capacity the node does not have", () => {
		const resolved = resolveBudget({
			node,
			workspace: { ceiling: { deadlineMs: 9_000_000 } },
			declared: { deadlineMs: 9_000_000 },
		});
		expect(resolved.deadlineMs.effective).toBe(600_000);
		expect(resolved.deadlineMs.boundBy).toBe("node");
	});

	it("prefers a workspace default over the node default", () => {
		const resolved = resolveBudget({
			node,
			workspace: { default: { deadlineMs: 90_000 } },
		});
		expect(resolved.deadlineMs).toEqual({
			effective: 90_000,
			declared: null,
			boundBy: "default",
		});
	});

	it("resolves each axis independently", () => {
		const resolved = resolveBudget({
			node,
			declared: { deadlineMs: 9_000_000, maxTokens: 1_000 },
		});
		expect(resolved.deadlineMs.boundBy).toBe("node");
		expect(resolved.maxTokens).toEqual({
			effective: 1_000,
			declared: 1_000,
			boundBy: "declared",
		});
		expect(resolved.maxUsd.boundBy).toBe("default");
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @refarm.dev/budget-contract-v1 run test`
Expected: FAIL — cannot resolve `./resolve.js`.

- [ ] **Step 4: Write `resolve.ts`**

```ts
import {
	BUDGET_AXES,
	type BudgetAxis,
	type BudgetResolutionInput,
	type ResolvedAxis,
	type ResolvedBudget,
} from "./types.js";

/**
 * Resolve one axis across the three levels (D9). Outward to inward:
 * the node bounds what it can serve, the workspace bounds within that, and the
 * dispatch declares within both. A workspace ceiling above the node's is clamped
 * rather than obeyed — a workspace cannot grant capacity the machine lacks.
 */
function resolveAxis(
	axis: BudgetAxis,
	input: BudgetResolutionInput,
): ResolvedAxis {
	const nodeCeiling = input.node.ceiling[axis];
	const workspaceCeiling = input.workspace?.ceiling?.[axis];
	const declared = input.declared?.[axis];
	const fallback = input.workspace?.default?.[axis] ?? input.node.default[axis];

	const ceiling =
		workspaceCeiling === undefined
			? nodeCeiling
			: Math.min(workspaceCeiling, nodeCeiling);

	const requested = declared ?? fallback;

	// Within the ceiling: whoever supplied the number gets the credit.
	if (requested <= ceiling) {
		return {
			effective: requested,
			declared: declared ?? null,
			boundBy: declared === undefined ? "default" : "declared",
		};
	}

	// Clamped: name the level that actually cut it, so raising the wrong ceiling
	// is not the operator's next move.
	const cutByWorkspace =
		workspaceCeiling !== undefined && workspaceCeiling <= nodeCeiling;
	return {
		effective: ceiling,
		declared: declared ?? null,
		boundBy: cutByWorkspace ? "workspace" : "node",
	};
}

export function resolveBudget(input: BudgetResolutionInput): ResolvedBudget {
	return Object.fromEntries(
		BUDGET_AXES.map((axis) => [axis, resolveAxis(axis, input)]),
	) as ResolvedBudget;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @refarm.dev/budget-contract-v1 run test`
Expected: PASS, 7 tests.

- [ ] **Step 6: Write the conformance suite**

`conformance.ts` re-runs the seven behaviours above against an *injected* implementation, so Task 5's
Rust mirror can be checked against the same list rather than a re-worded one:

```ts
import { resolveBudget } from "./resolve.js";
import type { BudgetResolutionInput, ResolvedBudget } from "./types.js";

export type BudgetResolver = (input: BudgetResolutionInput) => ResolvedBudget;

export type ConformanceCheck = {
	name: string;
	input: BudgetResolutionInput;
	axis: "deadlineMs" | "maxTokens" | "maxUsd";
	expect: { effective: number; declared: number | null; boundBy: string };
};

export type ConformanceReport = {
	total: number;
	passed: number;
	failures: { name: string; expected: unknown; actual: unknown }[];
};

/** The checks, as data. A Rust or WASM implementation runs the same list. */
export const BUDGET_CONFORMANCE_CHECKS: readonly ConformanceCheck[] = [
	/* one entry per behaviour asserted in resolve.test.ts, same numbers */
];

export function runBudgetConformance(
	resolve: BudgetResolver = resolveBudget,
): ConformanceReport {
	const failures: ConformanceReport["failures"] = [];
	for (const check of BUDGET_CONFORMANCE_CHECKS) {
		const actual = resolve(check.input)[check.axis];
		if (
			actual.effective !== check.expect.effective ||
			actual.declared !== check.expect.declared ||
			actual.boundBy !== check.expect.boundBy
		) {
			failures.push({ name: check.name, expected: check.expect, actual });
		}
	}
	return {
		total: BUDGET_CONFORMANCE_CHECKS.length,
		passed: BUDGET_CONFORMANCE_CHECKS.length - failures.length,
		failures,
	};
}
```

Fill `BUDGET_CONFORMANCE_CHECKS` with one entry per behaviour from Step 2, reusing the exact `node`
fixture and numbers. `conformance.test.ts` asserts `runBudgetConformance().failures` is empty and
that `total` is 7 — a check list that silently shrinks is worse than a failing one.

`index.ts` re-exports everything from `types.ts`, `resolve.ts` and `conformance.ts`.

- [ ] **Step 7: Feed the two hand-maintained registries**

The `before-push` lane detects a missing registration but does not supply it.

In `scripts/ci/subprocess-utils.mjs`, add `"packages/budget-contract-v1",` to
`TASK_SMOKE_TS_BUILD_ORDER` immediately after `"packages/effort-contract-v1",`. It has no workspace
dependencies beyond the shared configs, so that position is safe.

In `scripts/ci/gate-smoke-contracts.mjs`, add beside the `effort-contract-v1` pair:

```js
	["packages/budget-contract-v1", "build"],
	["packages/budget-contract-v1", "test:unit"],
```

- [ ] **Step 8: Verify the package satisfies the scaffold contract**

Run: `pnpm run validate-packages && pnpm --filter @refarm.dev/budget-contract-v1 run build && pnpm --filter @refarm.dev/budget-contract-v1 run type-check && pnpm --filter @refarm.dev/budget-contract-v1 run lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/budget-contract-v1 scripts/ci
git commit -m "feat(budget): declare three axes, resolve them through three levels

The node bounds what it can serve, the workspace bounds within that, and the
dispatch declares within both — Kubernetes' ResourceQuota/LimitRange split,
without the YAML. A clamped run names the level that cut it, because 'it was
cut' without 'by whom' sends you to raise the wrong ceiling."
refarm agent finish --lane after-commit --run --json
```

---

### Task 5: The knob — dispatch resolves a declared budget

**Protected surface** (`packages/tractor/**`). Do not touch files beyond those named.

**Files:**
- Create: `packages/tractor/src/sidecar/budget.rs`
- Modify: `packages/tractor/src/sidecar/mod.rs:127-135` (the `Effort` struct), `mod.rs` module list
- Modify: `packages/tractor/src/sidecar/dispatch.rs:298-310, 701-705`

**Interfaces:**
- Consumes: the resolution behaviour proven by Task 4's conformance list.
- Produces: `ResolvedBudget { deadline_ms: ResolvedAxis, max_tokens: ResolvedAxis, max_usd: ResolvedAxis }`
  and `resolve_budget(declared: Option<&BudgetDeclaration>, workspace: Option<&WorkspaceBudget>, node: &NodeBudget) -> ResolvedBudget`,
  plus `Effort.budget: Option<BudgetDeclaration>` and `Effort.workspace_id: Option<String>`.

**The effort must carry its workspace identity explicitly** (`workspaceId` on the wire), not leave it
to be parsed back out of an operation id. Three consumers need it and none exists today: Task 9 keys
the workspace ceiling on it, Task 10's `refarm.workspace.id` label records it, and the credential
scope that the next spec will widen from
verb to verb×object needs the same object. Inferring it from a string at two call sites is how the
two drift apart. A dispatch with no workspace sends `None`, and D6 applies: absent, never `""`.

**Name the fold for what it is.** `resolve_axis` implements *nested policy resolution* — a value
resolved outward to inward across node, scope and request, reporting which level bound it. Budget is
its first consumer, not its definition. Keep the function and its doc comment free of budget-specific
language so the next consumer inherits it instead of copying it.

**Settled by the maintainer before this task (spec, Open Questions):** the workspace ceiling is
**policy**, so it lives in a **top-level `budget` section** of `.refarm/config.json`, beside
`surfaces` and `delivery` — not at `workspaces.<id>.budget`, which describes capacity. Shape:

```json
{
  "budget": {
    "node": {
      "default": { "deadlineMs": 45000, "maxTokens": 100000, "maxUsd": 1 },
      "ceiling": { "deadlineMs": 600000, "maxTokens": 500000, "maxUsd": 10 }
    },
    "workspaces": {
      "rcdc5": { "ceiling": { "deadlineMs": 300000 } }
    }
  }
}
```

Every key is optional: a config with no `budget` section resolves entirely from the node defaults in
`NodeBudget::from_env()`, which is what every existing installation will do.

- [ ] **Step 1: Write the failing test**

In `packages/tractor/src/sidecar/tests/` add `budget.rs` with the same seven behaviours the TS
conformance list names, against the Rust `resolve_budget`. Start with the two that matter most:

```rust
#[test]
fn declared_deadline_below_the_ceiling_is_honoured() {
    let node = NodeBudget {
        ceiling: BudgetTriple { deadline_ms: 600_000, max_tokens: 500_000, max_usd_millis: 10_000 },
        default: BudgetTriple { deadline_ms: 45_000, max_tokens: 100_000, max_usd_millis: 1_000 },
    };
    let declared = BudgetDeclaration { deadline_ms: Some(300_000), ..Default::default() };
    let resolved = resolve_budget(Some(&declared), None, &node);
    assert_eq!(resolved.deadline_ms.effective, 300_000);
    assert_eq!(resolved.deadline_ms.bound_by, BudgetLevel::Declared);
}

#[test]
fn a_workspace_cannot_grant_what_the_node_cannot_serve() {
    let node = NodeBudget {
        ceiling: BudgetTriple { deadline_ms: 600_000, max_tokens: 500_000, max_usd_millis: 10_000 },
        default: BudgetTriple { deadline_ms: 45_000, max_tokens: 100_000, max_usd_millis: 1_000 },
    };
    let workspace = WorkspaceBudget {
        ceiling: Some(BudgetDeclaration { deadline_ms: Some(9_000_000), ..Default::default() }),
        default: None,
    };
    let declared = BudgetDeclaration { deadline_ms: Some(9_000_000), ..Default::default() };
    let resolved = resolve_budget(Some(&declared), Some(&workspace), &node);
    assert_eq!(resolved.deadline_ms.effective, 600_000);
    assert_eq!(resolved.deadline_ms.bound_by, BudgetLevel::Node);
}
```

USD is carried as `max_usd_millis: u64` (thousandths of a dollar) so the fold stays in integer
arithmetic and the three axes share one code path. The TS side keeps `maxUsd` as a decimal at the
contract boundary; the conversion happens where the declaration is deserialised.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --lib sidecar::tests::budget --quiet`
Expected: FAIL — module `budget` not found.

- [ ] **Step 3: Write `budget.rs`**

Same clamp order and same `bound_by` rule as Task 4, in integer arithmetic. Declare `mod budget;` in
`sidecar/mod.rs` beside the other submodules.

```rust
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BudgetLevel {
    Node,
    Workspace,
    Declared,
    Default,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BudgetDeclaration {
    pub deadline_ms: Option<u64>,
    pub max_tokens: Option<u64>,
    /// Thousandths of a dollar. The wire carries `maxUsd` as a decimal; the
    /// deserialiser multiplies by 1000 so all three axes fold in integers.
    pub max_usd_millis: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct BudgetTriple {
    pub deadline_ms: u64,
    pub max_tokens: u64,
    pub max_usd_millis: u64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct NodeBudget {
    pub ceiling: BudgetTriple,
    pub default: BudgetTriple,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct WorkspaceBudget {
    pub ceiling: Option<BudgetDeclaration>,
    pub default: Option<BudgetDeclaration>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ResolvedAxis {
    pub effective: u64,
    pub declared: Option<u64>,
    pub bound_by: BudgetLevel,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ResolvedBudget {
    pub deadline_ms: ResolvedAxis,
    pub max_tokens: ResolvedAxis,
    pub max_usd_millis: ResolvedAxis,
}

/// One axis, three levels, resolved outward to inward (D9). A workspace ceiling
/// above the node's is clamped rather than obeyed: a workspace cannot grant
/// capacity the machine does not have.
fn resolve_axis(
    declared: Option<u64>,
    workspace_ceiling: Option<u64>,
    workspace_default: Option<u64>,
    node_ceiling: u64,
    node_default: u64,
) -> ResolvedAxis {
    let ceiling = match workspace_ceiling {
        Some(w) => w.min(node_ceiling),
        None => node_ceiling,
    };
    let fallback = workspace_default.unwrap_or(node_default);
    let requested = declared.unwrap_or(fallback);

    if requested <= ceiling {
        return ResolvedAxis {
            effective: requested,
            declared,
            bound_by: if declared.is_some() {
                BudgetLevel::Declared
            } else {
                BudgetLevel::Default
            },
        };
    }

    let cut_by_workspace = matches!(workspace_ceiling, Some(w) if w <= node_ceiling);
    ResolvedAxis {
        effective: ceiling,
        declared,
        bound_by: if cut_by_workspace {
            BudgetLevel::Workspace
        } else {
            BudgetLevel::Node
        },
    }
}

pub(crate) fn resolve_budget(
    declared: Option<&BudgetDeclaration>,
    workspace: Option<&WorkspaceBudget>,
    node: &NodeBudget,
) -> ResolvedBudget {
    let ws_ceiling = workspace.and_then(|w| w.ceiling);
    let ws_default = workspace.and_then(|w| w.default);
    ResolvedBudget {
        deadline_ms: resolve_axis(
            declared.and_then(|d| d.deadline_ms),
            ws_ceiling.and_then(|c| c.deadline_ms),
            ws_default.and_then(|d| d.deadline_ms),
            node.ceiling.deadline_ms,
            node.default.deadline_ms,
        ),
        max_tokens: resolve_axis(
            declared.and_then(|d| d.max_tokens),
            ws_ceiling.and_then(|c| c.max_tokens),
            ws_default.and_then(|d| d.max_tokens),
            node.ceiling.max_tokens,
            node.default.max_tokens,
        ),
        max_usd_millis: resolve_axis(
            declared.and_then(|d| d.max_usd_millis),
            ws_ceiling.and_then(|c| c.max_usd_millis),
            ws_default.and_then(|d| d.max_usd_millis),
            node.ceiling.max_usd_millis,
            node.default.max_usd_millis,
        ),
    }
}
```

`NodeBudget::from_env()` reads the existing variables as the node's default and ceiling:
`REFARM_RESPOND_WATCH_TIMEOUT_MS` (default 45_000) and a new
`REFARM_RESPOND_WATCH_CEILING_MS` (default 600_000). Keep `respond_watch_timeout_ms_from_env`
exactly as it is and call it — that function's tests at `dispatch.rs:986-999` must stay green.

- [ ] **Step 4: Carry the declaration on the effort**

In `packages/tractor/src/sidecar/mod.rs:127-135`, add to `Effort`:

```rust
    #[serde(default)]
    pub budget: Option<crate::sidecar::budget::BudgetDeclaration>,
```

`Effort` already derives `Deserialize` with `rename_all = "camelCase"`, so the wire field is
`budget` with camelCase axis names, matching Task 4's TS type.

- [ ] **Step 5: Use the resolved deadline in the watcher**

In `dispatch.rs`, `dispatch_effort` resolves the budget once and passes it to
`spawn_terminal_result_watcher`, which replaces:

```rust
        let timeout = std::time::Duration::from_millis(state.respond_watch.timeout_ms);
```

with the resolved effective deadline. `state.respond_watch.interval_ms` stays as it is — the poll
cadence is not a budget.

- [ ] **Step 6: Close the coverage gap Task 3 left in this same file**

Task 3 added `cache_read_input_tokens` and `cache_creation_input_tokens` to `usage_view_from_record`,
but the only test of that function, `usage_view_maps_record_to_the_device_wire_contract`
(`dispatch.rs`, test module), exercises a **legacy pre-split record** where both keys default to `0`
through the `count` helper. Nothing asserts the two keys on a record that actually carries them, so a
regression that dropped either line would pass. You are editing this file already; close it.

Add a second case to that test (or a sibling test beside it) that feeds a record carrying
`"cache_read_input_tokens": 100_000` and `"cache_creation_input_tokens": 2_048` and asserts both
surface on the view with those distinct values. Keep the existing legacy case as it is — it pins the
back-compat default, which is a separate and still-true rule.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cargo test --lib sidecar::tests::budget --quiet && cargo test --lib sidecar --quiet -- --test-threads=1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/tractor/src
git commit -m "feat(tractor): the dispatch deadline is declared by whoever spawns it

The prompt path has let the asker declare and the node clamp since it was
written; the dispatch path read a boot global. Same decision, same file family,
finally the same answer. The agent that died at 4/25 of an investigation on a
45s ceiling can now be given the budget the investigation needs."
refarm agent finish --lane after-commit --run --json
```

---

### Task 6: The cumulative token ceiling

Moves `MODEL_MAX_CONTEXT_TOKENS` from a prompt-size gate to a cumulative-usage ceiling (F6).

**Files:**
- Modify: `packages/agent/src/runtime/policy.rs:10-24`
- Test: `packages/agent/src/tests/runtime_cost_guard_tests.rs`

**Interfaces:**
- Consumes: Task 5's resolved `max_tokens`, threaded to the agent as an environment value on the
  dispatch (the agent runs as a WASM guest and reads its budget the way it reads its other limits).
- Produces: `cumulative_limit_error(spent: u32, limit: Option<u32>) -> Option<ReactResult>`, called
  after each turn's usage is known.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn a_run_that_starts_small_and_grows_is_stopped_at_the_ceiling() {
    // The old guard only measured the FIRST prompt. A run that begins under the
    // ceiling and then burns ten times it across tool loops was never stopped.
    assert!(cumulative_limit_error(9_999, Some(10_000)).is_none());
    let stopped = cumulative_limit_error(10_001, Some(10_000));
    assert!(stopped.is_some(), "cumulative spend past the ceiling must stop the run");
    let (content, _, _, _, _, _, _, model, _) = stopped.unwrap();
    assert!(content.contains("10000"), "the message must name the ceiling: {content}");
    assert_eq!(model, "blocked");
}

#[test]
fn no_ceiling_means_no_stop() {
    assert!(cumulative_limit_error(u32::MAX, None).is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --lib runtime_cost_guard --quiet`
Expected: FAIL — `cumulative_limit_error` not found.

- [ ] **Step 3: Implement it**

Add to `packages/agent/src/runtime/policy.rs`, keeping `context_limit_error` untouched (it guards a
different thing — a single prompt that cannot fit the context window at all):

```rust
/// Stop a run whose CUMULATIVE token spend has passed its declared ceiling.
/// Distinct from `context_limit_error`, which refuses a single prompt too large
/// for the context window. This one is the budget; that one is the container.
pub(crate) fn cumulative_limit_error(spent: u32, limit: Option<u32>) -> Option<ReactResult> {
    let limit = limit?;
    if spent <= limit {
        return None;
    }
    Some(blocked_result(format!(
        "[runtime-agent] orçamento de tokens esgotado ({spent} > {limit} tokens acumulados)"
    )))
}
```

- [ ] **Step 4: Add the currency ceiling beside it**

D1 enforces `maxUsd` **only** in `api` pricing mode, because `estimate_billable_usd` returns a
structural `0.0` under `subscription` and `local` and a ceiling over a structural zero can never
bind. Add to the same file:

```rust
/// Stop a run whose estimated spend has passed its declared ceiling. Returns
/// None outside `api` pricing mode: under a subscription or a local model the
/// estimate is a structural zero, and a ceiling that can never bind would teach
/// the operator to trust a guard that is not guarding. The token ceiling is what
/// holds the line there.
pub(crate) fn spend_limit_error(
    provider: &str,
    spent_usd: f64,
    limit_usd: Option<f64>,
) -> Option<ReactResult> {
    if crate::pricing_mode_for_provider(provider) != "api" {
        return None;
    }
    let limit = limit_usd?;
    if spent_usd <= limit {
        return None;
    }
    Some(blocked_result(format!(
        "[runtime-agent] orçamento estimado esgotado (US$ {spent_usd:.4} > US$ {limit:.4})"
    )))
}
```

And the test that pins the mode rule:

```rust
#[test]
fn a_currency_ceiling_never_binds_under_a_subscription() {
    // openai-codex bills a subscription; estimate_billable_usd returns 0.0 there
    // by design, so a USD ceiling would be theatre.
    assert!(spend_limit_error("openai-codex", 999.0, Some(0.01)).is_none());
    assert!(spend_limit_error("anthropic", 999.0, Some(0.01)).is_some());
}
```

- [ ] **Step 5: Call both after each turn**

In `packages/agent/src/runtime/react_loop.rs`, inside the agentic loop, after the turn's
`UsageTotals` are folded into the running total, call `cumulative_limit_error` and then
`spend_limit_error` with the resolved ceilings and return early if either fires. The token check runs
first: it is exact where the spend check is an estimate, so the more reliable guard reports the stop.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test --lib runtime_cost_guard --quiet && cargo test --lib --quiet`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/agent/src
git commit -m "feat(agent): the token ceiling counts what was spent, not what was asked

MODEL_MAX_CONTEXT_TOKENS measured the first prompt's estimated size and never
looked again, so a run that started under it and burned ten times it across tool
loops was never stopped. The context guard stays — a prompt too big for the
window is a different refusal from a budget that ran out."
refarm agent finish --lane after-commit --run --json
```

---

### Task 7: The estimator stops conflating "unknown" with "free", and names its rate table

**Why this exists** (added 2026-08-03 after the maintainer asked how cost accounting stays current
with a moving market): `estimate_usd` matches model ids by substring and its Claude branches stop at
`claude-opus-4` / `claude-sonnet-4` / `claude-sonnet-3-7`. `"claude-opus-5".contains("claude-opus-4")`
is false, so **every Claude 5 model falls through to `return 0.0` today** — the same value that means
"local model, genuinely free". The drift is not a future risk; it has already happened and nothing
reported it.

The root defect is that one return value carries two meanings. Until they are separable, no gate can
tell a free model from an unrecognised one.

**Files:**
- Modify: `packages/agent/src/utils.rs` (the `estimate_usd` rate table and its fall-through)
- Test: `packages/agent/src/tests/runtime_cost_guard_tests.rs`

**Interfaces:**
- Produces: `pub(crate) const RATE_TABLE_VERSION: &str` (bump this string whenever a rate or a branch
  changes — Task 10 stamps it onto every observation so historical records can be recomputed);
  `pub(crate) enum RateLookup { Priced { rate_in: f64, rate_out: f64 }, Free, Unknown }` and
  `pub(crate) fn rate_for_model(model: &str) -> RateLookup`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn a_known_free_model_and_an_unrecognised_one_are_not_the_same_answer() {
    // Both cost $0 to estimate. Only one of them costs $0 to RUN. Collapsing
    // them is how a new model id silently prices itself at nothing.
    assert!(matches!(rate_for_model("llama3.2"), RateLookup::Free));
    assert!(matches!(rate_for_model("mistral"), RateLookup::Free));
    assert!(matches!(rate_for_model("some-model-nobody-priced"), RateLookup::Unknown));
}

#[test]
fn an_unpriced_new_model_is_unknown_rather_than_free() {
    // The measured drift this task closes: the table's Claude branches stop at
    // the 4 family, so a Claude 5 id matched nothing and fell through to the
    // return value meaning "local model, genuinely free". It is now UNKNOWN —
    // still estimated at zero, but no longer indistinguishable from free, and
    // it says its own name in the log.
    assert!(matches!(rate_for_model("claude-opus-5"), RateLookup::Unknown));
    assert!(matches!(rate_for_model("claude-sonnet-5"), RateLookup::Unknown));
    // The 4 family still prices, so nothing in use today regressed.
    assert!(matches!(rate_for_model("claude-sonnet-4-6"), RateLookup::Priced { .. }));
}

#[test]
fn a_more_specific_model_id_wins_over_its_family_prefix() {
    // Substring matching is order-dependent: "gpt-5.5" must be tested before
    // the generic "gpt-5", or a point release lands on the wrong rate while
    // looking perfectly plausible.
    let RateLookup::Priced { rate_in: specific, .. } = rate_for_model("gpt-5.5") else {
        panic!("gpt-5.5 must be priced");
    };
    let RateLookup::Priced { rate_in: family, .. } = rate_for_model("gpt-5") else {
        panic!("gpt-5 must be priced");
    };
    assert_ne!(specific, family, "the point release must not inherit the family rate");
}

#[test]
fn the_rate_table_names_a_version() {
    assert!(!RATE_TABLE_VERSION.is_empty());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib runtime_cost_guard --quiet`
Expected: FAIL — `rate_for_model` not found.

- [ ] **Step 3: Extract the table behind a three-way lookup**

Move the existing `if / else if` chain out of `estimate_usd` into `rate_for_model`, returning
`RateLookup::Priced` for every branch it already has, **with no new priced branches and no changed
rates**. Return `RateLookup::Free` for an explicit known-free list (`llama`, `mistral`, `qwen`,
`gemma`, `phi`, `deepseek-r1` and anything ollama serves), and `RateLookup::Unknown` otherwise.

**No placeholder rates** (maintainer's ruling, 2026-08-03). An earlier draft of this task added
provisional Claude 5 branches carrying the 4-family rates. That would ship the table's first version
containing numbers nobody verified, and correcting them later would bump `RATE_TABLE_VERSION`,
marking every observation written in between as stale — churn manufactured during construction,
before the table's first version was settled. Measured while evaluating it: the repo's default
Anthropic model is `claude-sonnet-4-6`, which already matches the existing `claude-sonnet-4` branch,
so Task 8's gate passes without them and nothing forced the placeholders.

The deeper reason is worth keeping: **a placeholder is a number that looks like data.** Even labelled
provisional it flows into aggregation, into a chart, into a decision. `Unknown` flows nowhere
pretending to be a price, and the record carries tokens plus `rate_table_version`, so those runs stay
identifiable and recomputable the day real rates arrive.

`estimate_usd` then maps `Free` and `Unknown` both to `0.0` **for now** — the value does not change,
only its recoverability. Add a `tracing::warn!` on `Unknown` naming the model id, so an unpriced
model announces itself once per run instead of never.

Declare `RATE_TABLE_VERSION` beside the table, with a comment stating the rule: bump it whenever a
rate or a branch changes, because Task 10 stamps it onto every observation and Task 11 uses it to
decide which historical records predate a correction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib runtime_cost_guard --quiet && cargo test --lib --quiet`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/agent/src
git commit -m "fix(agent): an unpriced model is unknown, not free

The rate table's Claude branches stopped at the 4 family, so every Claude 5
model matched nothing and fell through to the return value that means 'local
model, genuinely free'. One value carried two meanings and no gate could tell
them apart, which is why the drift went unreported.

The lookup now answers Priced, Free or Unknown. Both still estimate zero dollars
today — what changed is that the zero is now recoverable, and an unknown model
says its own name in the log instead of costing nothing in silence."
refarm agent finish --lane after-commit --run --json
```

---

### Task 8: The drift gate requires a rate for every default model

`scripts/ci/check-model-defaults-drift.mjs` already cross-checks the default model ids in
`packages/config/src/model-routing.js` against the Rust constants in
`packages/agent/src/provider_config.rs`. It knows which models are canonical. It has never asked
whether they have a price. Extending it is how Task 7's fix stays fixed.

**Files:**
- Modify: `scripts/ci/check-model-defaults-drift.mjs`
- Test: the script's existing test harness if it has one; otherwise assert by running it

**Interfaces:**
- Consumes: Task 7's `rate_for_model` branch list, read from `packages/agent/src/utils.rs` as text
  (the script already reads `provider_config.rs` as text — follow that established pattern rather
  than introducing a build step to call into Rust).

- [ ] **Step 1: Write the failing check**

Add a case to the script that collects every default model id it already knows about, and for each
one asserts that `utils.rs` contains a matching branch. Prove it fails first by temporarily removing
one branch, running the script, and confirming it exits non-zero naming that model.

- [ ] **Step 2: Implement the check**

For each default model id, find whether any `model.contains("...")` literal in `rate_for_model` is a
substring of it, or whether it appears on the known-free list. Exit non-zero listing every default
model with no rate and no free-list entry, with a message that says what to do: add a branch to
`rate_for_model` and bump `RATE_TABLE_VERSION`.

- [ ] **Step 3: Delete `RateLookup::Free` — the model name cannot answer that question**

Task 8's own audit turned a hypothetical into three live defects, and they invalidate the concept
rather than the entries. Measured on the current tree:

| Provider | Default model | Classified | Reality |
| --- | --- | --- | --- |
| `groq` | `llama-3.3-70b-versatile` | **Free** → $0.00 | a paid API |
| `together` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | **Free** → $0.00 | a paid API |
| `mistral` | `mistral-medium-3-5` | **Free** → $0.00 | a paid API |

And the branch that justified the list is unreachable: `estimate_usd` is only called in production
through `estimate_billable_usd` (`utils.rs:55`), which already returns `0.0` for `subscription` and
`local` pricing modes. **Ollama never reaches the table at all.** So the free list is unreachable for
the case it was written for and wrong for every case it does reach.

The error in one sentence: **whether a model is free depends on who serves it, not on what it is
called.** Llama is free on your own hardware and sold by Groq and Together. The model name cannot
answer that question, and the provider axis, which can, already answers it earlier.

Remove `RateLookup::Free` and `KNOWN_FREE_MODEL_SUBSTRINGS` entirely. Anything reaching
`rate_for_model` is being sold by an `api`-mode provider; without a rate it is `Unknown`. This also
dissolves the narrow-the-substrings problem completely — no list, no collision.

```rust
#[test]
fn a_paid_provider_serving_an_open_weight_model_is_not_free() {
    // Groq and Together SELL Llama. Ollama serves it free, and never reaches
    // this table: estimate_billable_usd short-circuits on `local` pricing mode
    // before the lookup runs. A model id cannot tell you who is charging.
    assert!(matches!(rate_for_model("llama-3.3-70b-versatile"), RateLookup::Unknown));
    assert!(matches!(rate_for_model("mistral-medium-3-5"), RateLookup::Unknown));
    assert_eq!(
        estimate_billable_usd("ollama", "llama3.2", 10_000, 5_000, 0, 0),
        0.0,
        "local pricing mode still costs nothing, decided before the table"
    );
}
```

- [ ] **Step 4: Every rate cites where it was consulted**

The maintainer's ruling: a rate carries the source it came from, so the table is auditable now and
automatable later. Each priced branch gains a comment naming the vendor's **official** pricing page,
and the table header records the one machine-readable source found:
`https://openrouter.ai/api/v1/models` returns per-model prompt and completion pricing as JSON across
many providers, which a future task can consult as a **drift detector** — never as the source of
truth, since it is authoritative only for OpenRouter's own resale prices.

Do not transcribe rates from third-party aggregators. Several exist and are convenient; none is the
vendor. An unverified number presented as fact is the failure this whole task exists to prevent.

**Correct what the citation exposes, before v1 closes.** Fetching the sources to cite them is itself
an audit, and it found two rates that were wrong rather than merely unverified:

| Branch | Was | Verified | Direction |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | $0.80 / $4.00 (Haiku 3.5's retired rate) | $1.00 / $5.00 | under by 25% |
| `claude-opus-4-5` and later | $15.00 / $75.00 (matched `claude-opus-4`) | $5.00 / $25.00 | **over by 3×** |

Both are substring-order defects: `"claude-opus-4-5".contains("claude-opus-4")` is true, so the newer
generation inherited the older one's price. The fix is a more specific branch placed **before** the
family prefix, the same idiom the file already used for `gpt-5.5` before `gpt-5`. A specific branch
placed after its prefix is dead code that looks like a fix.

The two errors point in **opposite directions**, which is the argument against any heuristic: there is
no bias to correct for and no sanity check that would have caught them. Only the vendor's page
answers, one branch at a time.

Correcting here is free because nothing has been stamped yet — the task that writes observations has
not landed. `RATE_TABLE_VERSION` is therefore NOT bumped: v1 is still being assembled, and it closes
containing what someone opened and read.

**And only what someone read.** A branch that matches several model ids while its citation covers one
of them is the placeholder problem in a new costume. Narrow each branch to the ids the page actually
listed; the rest resolve to `Unknown`, say so in the log, and are caught by the gate if they ever
become a default.

- [ ] **Step 5: The baseline shrinks, it never grows**

Six default models have no rate: `grok-4.3`, `deepseek-v4-flash`, `gemini-3-flash-preview`, and — once
`Free` is gone — `llama-3.3-70b-versatile`, `meta-llama/Llama-3.3-70B-Instruct-Turbo` and
`mistral-medium-3-5`. The maintainer ruled that rates are not to be invented, so the gate ships with
an explicit, dated baseline of exactly those six, each carrying the official pricing URL where its
rate can be found.

The gate passes while the set is a subset of the baseline and **fails on anything new**, and it fails
if an entry is still listed after a rate exists for it. This is the shape `refarm hardening` already
uses in this repository: a baseline that only shrinks. Chronic red CI is CI nobody reads; an
enumerated debt is one somebody can close.

- [ ] **Step 6: Run it**

Run: `pnpm run models:defaults:check && cargo test --lib runtime_cost_guard --quiet`
Expected: exit 0 with the six baselined models reported as known debt, and the agent's guard tests
still pass.

- [ ] **Step 7: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add scripts/ci packages/agent/src
git commit -m "feat(ci): the model drift gate asks whether a default model has a price

It already knew which models are canonical and cross-checked their ids across
two sources. It never asked the question that actually rots: whether the
estimator can price them. A default model with no rate now fails the gate
instead of quietly estimating zero."
refarm agent finish --lane after-commit --run --json
```

---

### Task 9: The workspace budget comes from the sovereign config

**Why this exists:** Task 5 built the three-level fold and `dispatch.rs` calls it with `None` for the
workspace level. The fold handles a workspace ceiling and its tests cover one, but **no caller ever
supplies it**, so D9's middle level is unreachable in production. This was an omission in the plan,
not in Task 5 — the earlier steps described where the ceiling lives and never assigned reading it.

**Files:**
- Modify: `packages/tractor/src/sidecar/budget.rs` (config deserialisation)
- Modify: `packages/tractor/src/sidecar/dispatch.rs` (pass the resolved workspace budget)
- Test: `packages/tractor/src/sidecar/tests/budget.rs`

**Protected surface.** Only these files.

**Interfaces:**
- Consumes: `Effort.workspace_id` (added by Task 5), and the node's base directory, which the daemon
  already receives as `--refarm-dir` and threads to the auth policy — declaration resolution must ask
  for it, never `current_dir()`. That rule is settled repo policy; see
  `docs/superpowers/specs/2026-08-03-declared-node-base-design.md`.
- Produces: `fn workspace_budget_for(refarm_dir: &Path, workspace_id: Option<&str>) -> Option<WorkspaceBudget>`
  and `fn node_budget_from_config(refarm_dir: &Path, fallback: NodeBudget) -> NodeBudget`.

**Both halves of the section must be read, not just the workspace one.** The settled config shape
declares `budget.node.default` and `budget.node.ceiling` as well, and a plan that reads only
`budget.workspaces` would leave the node half **declared and ignored** — the same defect this task
exists to close, reintroduced one level up. `node_budget_from_config` layers over the environment
values rather than replacing them: config wins where present, `from_respond_watch` fills the rest, so
an installation with no `budget` section is untouched.

This also resolves a dead-code finding from Task 5's review: `NodeBudget::from_env()` currently has
zero callers, because `dispatch_effort` uses `from_respond_watch` to keep a test override working.
Either give it its caller here or fold it into `node_budget_from_config` and delete it. Do not leave
a constructor in the tree whose only justification is that a brief once named it.

The config shape, settled by the maintainer, is a TOP-LEVEL `budget` section:

```json
{
  "budget": {
    "node": {
      "default": { "deadlineMs": 45000, "maxTokens": 100000, "maxUsd": 1 },
      "ceiling": { "deadlineMs": 600000, "maxTokens": 500000, "maxUsd": 10 }
    },
    "workspaces": {
      "rcdc5": { "ceiling": { "deadlineMs": 300000 } }
    }
  }
}
```

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn a_config_with_no_budget_section_changes_nothing() {
    // Backward compatibility is not negotiable: every existing installation has
    // no budget section, and must resolve exactly as it did before this task.
    let dir = tempdir_with_config(r#"{ "workspaces": {} }"#);
    assert!(workspace_budget_for(dir.path(), Some("rcdc5")).is_none());
}

#[test]
fn a_workspace_ceiling_is_read_for_that_workspace_only() {
    let dir = tempdir_with_config(
        r#"{ "budget": { "workspaces": { "rcdc5": { "ceiling": { "deadlineMs": 300000 } } } } }"#,
    );
    let ws = workspace_budget_for(dir.path(), Some("rcdc5")).expect("declared");
    assert_eq!(ws.ceiling.and_then(|c| c.deadline_ms), Some(300_000));
    assert!(
        workspace_budget_for(dir.path(), Some("other")).is_none(),
        "one workspace's ceiling must not bind another"
    );
    assert!(
        workspace_budget_for(dir.path(), None).is_none(),
        "a dispatch with no workspace has no workspace ceiling"
    );
}

#[test]
fn max_usd_crosses_the_boundary_as_a_decimal_and_lands_as_millis() {
    let dir = tempdir_with_config(
        r#"{ "budget": { "workspaces": { "w": { "ceiling": { "maxUsd": 2.5 } } } } }"#,
    );
    let ws = workspace_budget_for(dir.path(), Some("w")).expect("declared");
    assert_eq!(ws.ceiling.and_then(|c| c.max_usd_millis), Some(2_500));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib sidecar::tests::budget --quiet`
Expected: FAIL — `workspace_budget_for` not found.

- [ ] **Step 3: Implement the read**

Deserialise the top-level `budget` section from `<refarm_dir>/.refarm/config.json` using the same
loader the sidecar already uses for its other declarations. Every key optional; a missing file, a
missing section, or a missing workspace all return `None` rather than erroring — a malformed config
is a different problem with a different owner, and a budget read must never be the thing that stops a
dispatch.

- [ ] **Step 4: Pass it at the call site**

In `dispatch.rs`, replace the `None` at the workspace position of `resolve_budget` with
`workspace_budget_for(&state.refarm_dir, effort.workspace_id.as_deref()).as_ref()`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib sidecar::tests::budget --quiet && cargo test --lib sidecar --quiet -- --test-threads=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/tractor/src
git commit -m "feat(tractor): the workspace level of the budget fold becomes reachable

The fold has handled three levels since it was written and its tests covered a
workspace ceiling, but the one production caller passed None, so the middle
level existed only in tests. It now reads the sovereign config's top-level
budget section, keyed by the workspace the effort carries.

A config with no budget section resolves exactly as before."
refarm agent finish --lane after-commit --run --json
```

---

### Task 10: The BudgetObservation record

**Protected surface.**

**Prerequisite in the agent crate.** `usage_record_node` in `packages/agent/src/response_nodes.rs`
must emit `"rate_table_version": crate::RATE_TABLE_VERSION` alongside the token counts. The sidecar
cannot read that constant: `packages/tractor` has no dependency on the agent crate, because the agent
is a WASM guest loaded at runtime rather than linked. Stamping it where the price is computed and
joining it like every other usage field is both the only route and the right one — the version
belongs to whoever priced the run.

**Files:**
- Modify: `packages/agent/src/response_nodes.rs` (the prerequisite above) and its schema test
- Create: `packages/tractor/src/sidecar/observation.rs`
- Modify: `packages/tractor/src/sidecar/dispatch.rs` — one call from `finalise_effort` (`:508`)
- Modify: `packages/tractor/src/sidecar/mod.rs` module list
- Test: `packages/tractor/src/sidecar/tests/observation.rs`

**Interfaces:**
- Consumes: Task 5's `ResolvedBudget`, Task 3's split usage fields, the existing
  `find_usage_for(namespace, prompt_ref)` (`dispatch.rs:676`).
- Produces: `write_budget_observation(state: &SidecarState, effort_id: &str, resolved: &ResolvedBudget, outcome: &str, elapsed_ms: u64)`.

- [ ] **Step 1: Write the failing test**

```rust
use super::budget::{BudgetLevel, BudgetTriple, NodeBudget, resolve_budget, BudgetDeclaration};

/// The run that started this whole design: a declared 300s cut to the node's 45s,
/// which then timed out at step 4 of a 25-step plan.
fn base_input() -> ObservationInput<'static> {
    let node = NodeBudget {
        ceiling: BudgetTriple { deadline_ms: 45_000, max_tokens: 500_000, max_usd_millis: 10_000 },
        default: BudgetTriple { deadline_ms: 45_000, max_tokens: 100_000, max_usd_millis: 1_000 },
    };
    let declared = BudgetDeclaration { deadline_ms: Some(300_000), ..Default::default() };
    ObservationInput {
        effort_id: "eff-1",
        prompt_ref: Some("urn:sovereign:prompt-1"),
        workspace_id: Some("rcdc5"),
        spawner: Some("termux"),
        outcome: "timed-out",
        elapsed_ms: 45_000,
        steps_completed: Some(4),
        steps_planned: Some(25),
        resolved: resolve_budget(Some(&declared), None, &node),
        usage: None,
    }
}

#[test]
fn the_observation_records_all_three_axes_asked_and_ruling() {
    let node = build_observation_node(base_input());
    assert_eq!(node["@type"], "BudgetObservation");
    assert_eq!(node["refarm.budget.deadline_ms.declared"], 300_000);
    assert_eq!(node["refarm.budget.deadline_ms.effective"], 45_000);
    assert_eq!(node["refarm.budget.bound_by"], "node");
    // The axes nobody declared are still recorded: an aggregate that only sees
    // the axis someone happened to set cannot say what the others cost.
    assert_eq!(node["refarm.budget.max_tokens.effective"], 100_000);
    assert_eq!(node["refarm.budget.max_usd.effective"], 1.0);
    assert_eq!(node["refarm.budget.max_tokens.declared"], serde_json::Value::Null);
    assert_eq!(node["refarm.outcome"], "timed-out");
    assert_eq!(node["refarm.outcome.steps_completed"], 4);
    assert_eq!(node["refarm.outcome.steps_planned"], 25);
    assert_eq!(node["refarm.workspace.id"], "rcdc5");
    assert_eq!(node["refarm.scenario.id"], serde_json::Value::Null);
}

#[test]
fn an_undeterminable_field_is_omitted_rather_than_zeroed() {
    // D6: absent is not zero. A run with no workspace must not read as
    // workspace "" or 0 once someone aggregates a thousand of these. Same for a
    // run with no plan, where a planned step count does not exist at all.
    let node = build_observation_node(ObservationInput {
        workspace_id: None,
        steps_planned: None,
        ..base_input()
    });
    assert!(
        node.get("refarm.workspace.id").is_none(),
        "an unknown workspace is absent, not empty"
    );
    assert!(
        node.get("refarm.outcome.steps_planned").is_none(),
        "a run with no plan has no planned total, which is not the same as zero"
    );
}

#[test]
fn the_joined_usage_lands_flat_under_otel_names() {
    // D2: a dataset consumer reads gen_ai.usage.input_tokens at THAT key. A
    // nested blob would make the vocabulary decorative.
    let node = build_observation_node(ObservationInput {
        usage: Some(serde_json::json!({
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "usage": {
                "tokens_in": 50,
                "tokens_out": 10,
                "cache_read_input_tokens": 100_000,
                "cache_creation_input_tokens": 2_048,
                "pricing_mode": "api",
                "estimated_usd": 0.0301,
            }
        })),
        ..base_input()
    });
    assert_eq!(node["gen_ai.usage.input_tokens"], 50);
    assert_eq!(node["gen_ai.usage.cache_read.input_tokens"], 100_000);
    assert_eq!(node["gen_ai.usage.cache_creation.input_tokens"], 2_048);
    assert_eq!(node["gen_ai.provider.name"], "anthropic");
    assert_eq!(node["refarm.cost.estimated_usd"], 0.0301);
    assert!(
        node.get("refarm.usage").is_none(),
        "usage must be flattened, never nested under an opaque key"
    );
}

#[test]
fn a_currency_ceiling_records_that_it_could_not_bind() {
    // D1: under a subscription the estimate is a structural zero, so a USD
    // ceiling can never bind. Recording it without saying so would let an
    // aggregate read an unenforced ceiling as a satisfied one.
    let subscription = build_observation_node(ObservationInput {
        usage: Some(serde_json::json!({ "usage": { "pricing_mode": "subscription" } })),
        ..base_input()
    });
    assert_eq!(subscription["refarm.budget.max_usd.enforced"], false);

    let api = build_observation_node(ObservationInput {
        usage: Some(serde_json::json!({ "usage": { "pricing_mode": "api" } })),
        ..base_input()
    });
    assert_eq!(api["refarm.budget.max_usd.enforced"], true);

    // Unknown pricing mode is absent, never a default true (D6).
    let unknown = build_observation_node(base_input());
    assert!(unknown.get("refarm.budget.max_usd.enforced").is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --lib sidecar::tests::observation --quiet`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `observation.rs`**

```rust
pub(crate) struct ObservationInput<'a> {
    pub effort_id: &'a str,
    pub prompt_ref: Option<&'a str>,
    pub workspace_id: Option<&'a str>,
    pub spawner: Option<&'a str>,
    pub outcome: &'a str,
    pub elapsed_ms: u64,
    pub steps_completed: Option<u32>,
    pub steps_planned: Option<u32>,
    pub resolved: super::budget::ResolvedBudget,
    /// The usage view from `find_usage_for`, already joined on prompt_ref.
    /// FLATTENED onto the node under OTel names — never nested (D2).
    pub usage: Option<serde_json::Value>,
}

/// Copy the joined UsageRecord onto the node under the OTel names D2 promises.
/// Flat, never nested: a dataset consumer reading `gen_ai.usage.input_tokens`
/// must find it at that key, or adopting the vocabulary was decorative.
/// A field the joined record does not carry is OMITTED, per D6 — a run whose
/// usage never landed is not a run that used zero tokens.
fn put_usage(
    map: &mut serde_json::Map<String, serde_json::Value>,
    usage: Option<&serde_json::Value>,
) {
    let Some(usage) = usage else { return };
    let u = usage.get("usage").unwrap_or(usage);
    let mut copy = |from: &str, to: &str| {
        if let Some(v) = u.get(from) {
            map.insert(to.to_string(), v.clone());
        }
    };
    copy("tokens_in", "gen_ai.usage.input_tokens");
    copy("tokens_out", "gen_ai.usage.output_tokens");
    copy("tokens_reasoning", "gen_ai.usage.reasoning.output_tokens");
    copy("cache_read_input_tokens", "gen_ai.usage.cache_read.input_tokens");
    copy(
        "cache_creation_input_tokens",
        "gen_ai.usage.cache_creation.input_tokens",
    );
    copy("estimated_usd", "refarm.cost.estimated_usd");
    // Which rate table priced this run. Joined from the UsageRecord rather than
    // read locally, because `packages/tractor` does NOT depend on the agent
    // crate — the agent is a WASM guest loaded at runtime, and RATE_TABLE_VERSION
    // lives there. The version belongs to whoever computed the price, so it
    // travels WITH the price. Without it, a later correction to the table cannot
    // tell which historical records predate it and recomputing becomes guesswork:
    // tokens do not drift, prices do, so the record stamps the thing that drifts
    // and keeps the thing that does not.
    copy("rate_table_version", "refarm.cost.rate_table_version");
    if let Some(v) = usage.get("provider") {
        map.insert("gen_ai.provider.name".into(), v.clone());
    }
    if let Some(v) = usage.get("model") {
        map.insert("gen_ai.request.model".into(), v.clone());
    }
    if let Some(v) = u.get("pricing_mode") {
        map.insert("refarm.pricing_mode".into(), v.clone());
    }
}

fn axis_level_str(level: super::budget::BudgetLevel) -> &'static str {
    match level {
        super::budget::BudgetLevel::Node => "node",
        super::budget::BudgetLevel::Workspace => "workspace",
        super::budget::BudgetLevel::Declared => "declared",
        super::budget::BudgetLevel::Default => "default",
    }
}

/// Insert only when the value exists. D6: an omitted field means "not
/// determined"; a zero means "determined to be zero". Aggregating a mixture of
/// the two silently averages a lie.
fn put_opt(map: &mut serde_json::Map<String, serde_json::Value>, key: &str, value: Option<serde_json::Value>) {
    if let Some(v) = value {
        map.insert(key.to_string(), v);
    }
}

pub(crate) fn build_observation_node(input: ObservationInput<'_>) -> serde_json::Value {
    let b = &input.resolved;
    let mut map = serde_json::Map::new();
    map.insert("@type".into(), "BudgetObservation".into());
    map.insert("@id".into(), crate::mint_urn("budget-observation").into());
    map.insert("effort_id".into(), input.effort_id.into());
    map.insert("refarm.outcome".into(), input.outcome.into());
    map.insert("refarm.elapsed_ms".into(), input.elapsed_ms.into());

    map.insert("refarm.budget.deadline_ms.effective".into(), b.deadline_ms.effective.into());
    map.insert("refarm.budget.max_tokens.effective".into(), b.max_tokens.effective.into());
    // Millis back to a decimal at the record boundary, where a human reads it.
    map.insert(
        "refarm.budget.max_usd.effective".into(),
        serde_json::json!(b.max_usd_millis.effective as f64 / 1000.0),
    );
    map.insert(
        "refarm.budget.deadline_ms.declared".into(),
        b.deadline_ms.declared.map(Into::into).unwrap_or(serde_json::Value::Null),
    );
    map.insert(
        "refarm.budget.max_tokens.declared".into(),
        b.max_tokens.declared.map(Into::into).unwrap_or(serde_json::Value::Null),
    );
    map.insert(
        "refarm.budget.max_usd.declared".into(),
        b.max_usd_millis
            .declared
            .map(|m| serde_json::json!(m as f64 / 1000.0))
            .unwrap_or(serde_json::Value::Null),
    );
    // The deadline is the axis that stops a run in practice, so its level is the
    // headline one. Per-axis levels ride beside it.
    map.insert("refarm.budget.bound_by".into(), axis_level_str(b.deadline_ms.bound_by).into());
    map.insert(
        "refarm.budget.bound_by.max_tokens".into(),
        axis_level_str(b.max_tokens.bound_by).into(),
    );
    map.insert(
        "refarm.budget.bound_by.max_usd".into(),
        axis_level_str(b.max_usd_millis.bound_by).into(),
    );

    // Field use has no scenario. The bench (spec slices 6-8) sets these.
    map.insert("refarm.scenario.id".into(), serde_json::Value::Null);
    map.insert("refarm.scenario.hash".into(), serde_json::Value::Null);

    put_opt(&mut map, "prompt_ref", input.prompt_ref.map(Into::into));
    put_opt(&mut map, "refarm.workspace.id", input.workspace_id.map(Into::into));
    put_opt(&mut map, "refarm.budget.spawner", input.spawner.map(Into::into));
    put_opt(&mut map, "refarm.outcome.steps_completed", input.steps_completed.map(Into::into));
    put_opt(&mut map, "refarm.outcome.steps_planned", input.steps_planned.map(Into::into));

    put_usage(&mut map, input.usage.as_ref());

    // A currency ceiling cannot bind where the estimate is a structural zero
    // (D1). Recorded explicitly rather than inferred by every future reader:
    // an unenforced ceiling that reads as a satisfied one is the exact failure
    // D1 exists to prevent. Absent pricing mode means unknown, so absent here
    // too, per D6 — never a default `true`.
    if let Some(mode) = map.get("refarm.pricing_mode").and_then(|v| v.as_str()) {
        let enforced = mode == "api";
        map.insert("refarm.budget.max_usd.enforced".into(), enforced.into());
    }


    map.insert("timestamp_ns".into(), crate::now_ns().into());
    serde_json::Value::Object(map)
}
```

`write_budget_observation` opens `NativeStorage::open(&state.namespace)`, calls
`find_usage_for(&state.namespace, prompt_ref)` to fill `usage`, builds the node and calls
`store_node(&id, "BudgetObservation", None, &payload, Some("sidecar"))`. **Every failure path logs at
`warn` and returns** — D5: the instrument may lose a data point, it may not cost an operation. Write
it with no `?` that can escape and no `unwrap`.

`write_budget_observation` opens `NativeStorage::open(&state.namespace)`, calls
`find_usage_for(&state.namespace, prompt_ref)` to fold in the token counts, builds the node and calls
`store_node`. **Every failure path logs at `warn` and returns** — D5: the instrument may lose a data
point, it may not cost an operation.

- [ ] **Step 4: Call it from the terminal transition**

In `finalise_effort` (`dispatch.rs:508`), after the effort reaches a terminal status, call
`write_budget_observation`. It is the single place every terminal path passes through, which is why
the record cannot miss a `cancelled` or a `failed`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib sidecar::tests::observation --quiet && cargo test --lib sidecar --quiet`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/tractor/src
git commit -m "feat(tractor): every terminal effort leaves the budget that governed it

Written into the CRDT node store beside the UsageRecord it joins to, which has
no TTL — unlike the effort results, which are reaped at 24h under a premise that
was right for operational state and wrong for evidence.

Losing an observation never fails the run it observed."
refarm agent finish --lane after-commit --run --json
```

---

### Task 11: Read it back

The operator is the record's first consumer, and this is the check that the join actually joins.

**Files:**
- Create: `apps/refarm/src/commands/budget.ts`
- Modify: the command registry in `apps/refarm/src/` that mounts sibling commands (follow
  `commands/workspace.ts` for the registration pattern)
- Test: `apps/refarm/src/commands/budget.test.ts`

**Interfaces:**
- Consumes: `BudgetObservation` nodes written by Task 10, including the
  `refarm.cost.rate_table_version` stamp Task 7 introduced.
- Produces: `refarm budget observations --json` returning
  `{ observations: [...], summary: { total, timedOut, boundByNode, boundByWorkspace }, ok, nextCommand, nextCommands }`.

Every JSON command in this repo exposes `ok`, `nextCommand` and `nextCommands` (CLAUDE.md §4). Follow
`refarm delivery list --json` for the exact envelope.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { summariseObservations } from "./budget.js";

describe("summariseObservations", () => {
	it("counts the runs the node cut, so a hit ceiling is visible", () => {
		const summary = summariseObservations([
			{ "refarm.outcome": "done", "refarm.budget.bound_by": "declared" },
			{ "refarm.outcome": "timed-out", "refarm.budget.bound_by": "node" },
			{ "refarm.outcome": "timed-out", "refarm.budget.bound_by": "node" },
		]);
		expect(summary).toEqual({
			total: 3,
			timedOut: 2,
			boundByNode: 2,
			boundByWorkspace: 0,
		});
	});

	it("reports zeroes rather than throwing on an empty record", () => {
		expect(summariseObservations([])).toEqual({
			total: 0,
			timedOut: 0,
			boundByNode: 0,
			boundByWorkspace: 0,
		});
	});

	it("counts observations priced by a rate table that is no longer current", () => {
		// Tokens do not drift; prices do. An observation stamped with a
		// superseded rate table still holds true token counts, so its cost is
		// recomputable — but only if the reader can find it.
		const summary = summariseObservations(
			[
				{ "refarm.cost.rate_table_version": "2026-08-03" },
				{ "refarm.cost.rate_table_version": "2026-01-01" },
				{},
			],
			"2026-08-03",
		);
		expect(summary.stalePricing).toBe(1);
		expect(summary.unstampedPricing).toBe(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter refarm run test -- budget`
Expected: FAIL — cannot resolve `./budget.js`.

- [ ] **Step 3: Implement `summariseObservations` and the command**

```ts
export type ObservationNode = Record<string, unknown>;

export type ObservationSummary = {
	total: number;
	timedOut: number;
	boundByNode: number;
	boundByWorkspace: number;
	/** Observations priced by a rate table that has since been superseded. */
	stalePricing: number;
	/** Observations written before the rate table was stamped at all. */
	unstampedPricing: number;
};

/** Pure reducer over the record. Kept separate from the command so the counting
 *  rule is testable without a running node. */
export function summariseObservations(
	nodes: readonly ObservationNode[],
	currentRateTable?: string,
): ObservationSummary {
	let timedOut = 0;
	let boundByNode = 0;
	let boundByWorkspace = 0;
	let stalePricing = 0;
	let unstampedPricing = 0;
	for (const node of nodes) {
		if (node["refarm.outcome"] === "timed-out") timedOut += 1;
		const boundBy = node["refarm.budget.bound_by"];
		if (boundBy === "node") boundByNode += 1;
		if (boundBy === "workspace") boundByWorkspace += 1;
		const stamped = node["refarm.cost.rate_table_version"];
		if (stamped === undefined) unstampedPricing += 1;
		else if (currentRateTable !== undefined && stamped !== currentRateTable) {
			stalePricing += 1;
		}
	}
	return {
		total: nodes.length,
		timedOut,
		boundByNode,
		boundByWorkspace,
		stalePricing,
		unstampedPricing,
	};
}
```

The command reads the nodes through the existing sidecar client, applies the reducer, and prints the
envelope. When `total` is 0 the `nextAction` must say the record is empty rather than reporting an
all-clear — the repository has already been bitten once by a gate that reported success for work it
never ran.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter refarm run test -- budget && pnpm --filter refarm run type-check`
Expected: PASS.

- [ ] **Step 5: Verify against the record, not against a fixture**

Run the command against the real node and confirm it reads back the observations Task 10 has been
writing since it landed:

```bash
refarm budget observations --json
```

Expected: the envelope parses, `summary.total` matches the number of terminal efforts since Task 10,
and `stalePricing`/`unstampedPricing` count correctly against the current `RATE_TABLE_VERSION`.

**The end-to-end proof moved to Task 13** and the reason is a gap this task surfaced: no spawner
surface can declare a budget today. `Effort.budget` exists on the wire, the node resolves it, the
record captures it — and `refarm dispatch` has no `--budget-*` flag, `farm-client` has no option, so
the program's own thesis is unreachable from anywhere the operator stands. A proof step here would
have had to invoke a command that does not exist.

- [ ] **Step 6: Commit and run the handoff lanes**

```bash
refarm agent finish --lane after-edit --run --json
git add apps/refarm/src
git commit -m "feat(refarm): read the budget record back, and say which ceiling cut what

The operator is the record's first consumer. A hit ceiling that nobody can see
is a ceiling nobody will raise."
refarm agent finish --lane after-commit --run --json
refarm agent finish --lane handoffs --run --json
```

The `handoffs` lane is required here and not in earlier tasks: this is the task that changes public
JSON output (CLAUDE.md §4).

---

### Task 12: The resolved ceiling reaches the agent, and the counter is genuinely cumulative

**Why this exists** (added 2026-08-03, from Task 6's own report): Task 6 built `cumulative_limit_error`
and `spend_limit_error` correctly, and both are **inert**. Two things are missing and neither had an
owner:

1. **Nothing carries the resolved ceiling from the sidecar to the agent.** Task 5 resolves a
   `ResolvedBudget` per dispatch; the agent runs as a WASM guest and never sees it. The call site
   passes `None`, which is why nothing changed for existing runs.
2. **The total at the call site is per-turn, not cumulative.** No cross-turn counter exists reachable
   without restructuring the react loop, which Task 6 was explicitly forbidden from doing. A per-turn
   check does not close F6: the whole finding was that a run which starts under the ceiling and burns
   ten times it across tool loops is never stopped, and a per-turn check would not stop it either.

Until both land, the token and cost axes are **declarable but unenforced** — the shape D1 named as a
failure and refused for `maxUsd` under subscription pricing. The same rule applies here: what is not
enforced must not read as enforced.

**Files:**
- Modify: `packages/tractor/src/sidecar/dispatch.rs` (pass the resolved ceilings into the spawn
  environment) — protected surface, this file only
- Modify: `packages/agent/src/runtime/react_loop.rs` (the cumulative counter and the guard call site)
- Modify: `packages/agent/src/runtime/policy.rs` if the guards need a shared accumulator type
- Test: `packages/agent/src/tests/runtime_cost_guard_tests.rs`, plus a sidecar test that the
  environment carries the resolved values

**Interfaces:**
- Consumes: Task 5's `ResolvedBudget`, Task 6's `cumulative_limit_error` and `spend_limit_error`.
- Produces: a cumulative `UsageTotals`-shaped accumulator that survives across turns within one run,
  and two environment keys the agent reads its ceilings from.

**Design note before writing code.** The repo already declares a `spawnEnv` section in
`.refarm/config.json` and the sidecar already builds a fail-closed spawn environment for declared
operations. Carry the ceilings there rather than inventing a second channel — the announcement
contract's D2 recorded that fragmentation across `stream:v1`, `connection_frames` and `login-flow`
was a real cost, and a fourth road for one more value would repeat it.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn spend_accumulates_across_turns_rather_than_resetting_each_one() {
    // F6's actual finding: a run that starts under the ceiling and burns ten
    // times it across tool loops. A per-turn check never sees it.
    let mut run = RunTotals::default();
    run.add_turn(4_000, 1_000);   // turn 1: 5k, under a 10k ceiling
    assert!(cumulative_limit_error(run.total(), Some(10_000)).is_none());
    run.add_turn(4_000, 1_000);   // turn 2: 10k cumulative, exactly at it
    assert!(cumulative_limit_error(run.total(), Some(10_000)).is_none());
    run.add_turn(1, 0);           // turn 3: past it
    assert!(
        cumulative_limit_error(run.total(), Some(10_000)).is_some(),
        "three small turns that together exceed the ceiling must stop the run"
    );
}

#[test]
fn a_ceiling_that_never_arrives_leaves_the_run_unbounded() {
    // Backward compatibility: an installation that declares nothing behaves
    // exactly as it did before this task.
    let mut run = RunTotals::default();
    run.add_turn(u32::MAX / 2, u32::MAX / 2);
    assert!(cumulative_limit_error(run.total(), None).is_none());
}
```

Add a sidecar-side test asserting that a dispatch carrying a declared budget puts the resolved
`max_tokens` and `max_usd` into the spawn environment, and that a dispatch with no budget puts
nothing there rather than a zero.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib runtime_cost_guard --quiet`
Expected: FAIL — `RunTotals` not found.

- [ ] **Step 3: Implement the accumulator and the plumbing**

Keep `RunTotals` minimal: the sum of `tokens_in + tokens_out` across turns, plus the accumulated
estimated spend. It lives for one run. Do not reuse `UsageTotals`, which is per-call and already has
a different job.

On the sidecar side, add the resolved ceilings to the spawn environment beside the values it already
sets. A dispatch with no resolved ceiling for an axis sets **no key**, not a zero — a zero ceiling
would stop every run instantly, which is the worst possible reading of "absent".

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib runtime_cost_guard --quiet && cargo test --lib --quiet && cargo test --lib sidecar --quiet -- --test-threads=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/agent/src packages/tractor/src
git commit -m "feat(agent): the token and cost ceilings finally bind

Task 6 built both guards and left them inert: nothing carried the resolved
ceiling from the node to the guest, and the total at the call site was per-turn.
A per-turn check does not close the finding that produced this work — a run that
starts under the ceiling and burns ten times it across tool loops passes every
individual turn.

The ceilings now ride the spawn environment the sidecar already builds, rather
than a fourth road of their own, and the counter survives the loop."
refarm agent finish --lane after-commit --run --json
```

---

### Task 13: A spawner can actually declare, and the loop closes end to end

**Why this exists** (found while preparing Task 11): every layer of this program is in place except
the first one. `Effort.budget` is on the wire, `resolve_budget` folds it, `BudgetObservation` records
it — and **nothing the operator uses can set it**. `refarm dispatch` has no budget flag, `farm-client`
has no option. "Whoever spawns declares" is, today, reachable only by hand-crafting HTTP.

That is the shape this repository has been bitten by before, and it has a memory of its own: a slice
reported as end-to-end when it had only been proven over HTTP, while the operator's own `farm-start`
never carried an id. Written, correct, and unreachable.

**Files:**
- Modify: `apps/refarm/src/commands/dispatch.ts` (the three budget flags)
- Modify: `packages/farm-client/src/index.js` (the same declaration from the phone kit)
- Test: the command's own test file, plus `farm-client`'s

**Interfaces:**
- Consumes: `Effort.budget`'s wire shape from Task 5 (`{deadlineMs?, maxTokens?, maxUsd?}`, camelCase).
- Produces: `--budget-deadline-ms`, `--budget-max-tokens`, `--budget-max-usd` on the dispatch surface,
  each optional, absent meaning absent rather than zero.

- [ ] **Step 1: Write the failing test**

Assert that the flags parse into the wire shape, that omitting a flag omits the field entirely rather
than sending `0` or `null`, and that omitting all three sends no `budget` object at all — a dispatch
that declares nothing must be byte-identical to today's.

- [ ] **Step 2: Implement the flags**

`farm-client` is plain JavaScript and is the only package here with no TypeScript to refuse a typo, so
it lints with `no-undef` for exactly this reason. Keep the parsing in one place and reuse it.

- [ ] **Step 3: The end-to-end proof, from the surface the operator actually types**

This is the step the whole plan has been building toward. Run it against the real node:

```bash
refarm dispatch <plugin> <verb> --budget-deadline-ms 120000
refarm budget observations --json
```

Expected: an observation whose `refarm.budget.deadline_ms.declared` is `120000`, whose
`refarm.budget.bound_by` is `declared`, and whose `refarm.budget.max_tokens.effective` came from the
node default rather than from nowhere.

**If the runtime is not available, say so plainly and report exactly what was and was not proven.**
Do not describe an HTTP-level check as an end-to-end proof. That specific substitution is the one this
repository has already paid for once.

- [ ] **Step 4: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add apps/refarm/src packages/farm-client
git commit -m "feat(refarm): a spawner can finally declare its own budget

Every layer of the budget program was in place except the first: the wire
carried it, the node resolved it, the record captured it, and nothing the
operator uses could set it. Whoever spawns declares was reachable only by
hand-crafting HTTP."
refarm agent finish --lane after-commit --run --json
refarm agent finish --lane handoffs --run --json
```

---

## After this plan

Update [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) and `.project/handoff.json`.

**Then the credential scope, before slices 6–8.** The maintainer decided on 2026-08-03 that the next
spec widens the credential scope from a verb to verb×object — `start-operations` to
`start-operations@<workspace>` — so a workspace can declare its own auth the way D9 lets it declare
its own budget. The reason it goes next rather than later is arithmetic: `Scope` is a closed enum of
three variants and `scoped-credential.v1` is a versioned wire contract with almost nothing issued
against it. Widening it now is a toy migration; widening it after credentials are spread across
devices is a v2 and a coexistence window. It inherits this plan's two prerequisites: the workspace
identity Task 5 puts on the effort, and the nested resolution fold Task 5 keeps free of
budget-specific language.

**Then spec slices 6–8** (the sweep, the gallery, closing the loop). By then the record will hold
real observations, which is what slice 8 needs in order to derive a default and a ceiling from
evidence instead of from a constant.
