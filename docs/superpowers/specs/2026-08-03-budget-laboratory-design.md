# The budget belongs to whoever spawns, and the evidence outlives the run

Date: 2026-08-03
Status: DESIGN — approved by the operator through brainstorming; awaits the implementation plan.
Touches `packages/tractor/**` (protected, CLAUDE.md §8) and `packages/agent/**`. The maintainer
authorised the protected surface explicitly when choosing this slice.
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes

## What forced this

The refarm agent died at steps **4/25** and **6/25** of a real investigation, on a 45-second
ceiling, while using the right tools. The budget was sized for the agent to *reply*, not to
*investigate*.

The immediate cause is an asymmetry inside one crate. The prompt path lets the asker declare its
own deadline and the node merely clamps it (`sidecar/pending_prompt.rs:835`):

```rust
let timeout_ms = request
    .timeout_ms
    .unwrap_or(DEFAULT_PROMPT_TIMEOUT_MS)
    .min(MAX_PROMPT_TIMEOUT_MS);
```

The dispatch path reads a process global resolved once at boot
(`sidecar/dispatch.rs:578` → `SidecarState::new` → `sidecar/dispatch.rs:703`):

```rust
let timeout = std::time::Duration::from_millis(state.respond_watch.timeout_ms);
```

The same decision, taken twice in sibling files, right on one side and wrong on the other. Raising
the ceiling needs a runtime restart. The knob is out of reach exactly when you discover you need
it.

**The operator refused to take that fix alone**, and the refusal is the reason this document is
not a three-line patch:

> "Precisamos de um laboratório permanente de orçamento para poder criar políticas que persistam
> baseado em evidência que deve guardar muito do histórico do que foi usado e todos os parâmetros,
> se não trabalhamos sem gerar dados para trazer decisões."

A knob without a record manufactures the debt it was meant to remove: every surface picks a number,
nobody can say why, and in three months there are N guesses and zero data.

## The findings that decide the shape

### F1 — The parameter that governed the run is not recorded

`EffortResult` (`sidecar/mod.rs:71`) carries `{effort_id, status, results, submitted_at,
completed_at}`. It does not carry the ceiling that applied, nor the step the run reached. So
*"died at 4/25 under a 45s ceiling"*, the measurement that started all of this, **is not
recoverable from the record**. The consequence was felt, never stored.

### F2 — The evidence expires in 24 hours, on purpose

`sidecar/reap.rs:34` sets `DEFAULT_EFFORT_TTL_MS = 86_400_000`, and the comment above it states the
premise plainly: *"efforts are operational state, not durability — a generous TTL is safe."*

That premise is correct for its original purpose and **wrong for this one**. A budget laboratory
asserts the opposite: operational state *is* the evidence. This design reverses the premise
deliberately rather than by omission.

### F3 — A sweep is impossible today

Because the ceiling is a boot global, every data point in a budget sweep requires restarting the
daemon. The instrument cannot vary the parameter it exists to study. **This is why the knob and the
record are two halves of one thing, not two phases.**

### F4 — The durable home already exists, and so does the join key

The 24-hour reaper prunes filesystem effort results and streams. The CRDT node store
(`tractor/src/storage/sqlite.rs`) has **no TTL at all**, only `DELETE FROM nodes WHERE id = ?1`,
explicit deletion. `UsageRecordPayload` (`agent/src/response_nodes.rs:13`) already lands there with
provider, model, `tokens_in/out/cached/reasoning`, `usage_raw` and `duration_ms`. And the join key
already exists: `prompt_ref` is derived from `effort_id`, which is how `find_terminal_result`
correlates today.

No new database. The laboratory is built next to evidence that is already being collected.

### F5 — The cost estimate is wrong, and no test could have caught it

Found by curating the external standard (see *Prior art*), not by reading refarm alone.

`agent/src/provider_runtime/usage_totals.rs:13` collapses two Anthropic fields into one:

```rust
self.tokens_cached += (usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
    + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0)) as u32;
```

`agent/src/utils.rs:63` then prices the sum:

```rust
let uncached = tokens_in.saturating_sub(tokens_cached);
(uncached / 1e6) * rate_in + (cached / 1e6) * rate_in * 0.1 + (out / 1e6) * rate_out
```

Anthropic documents that `input_tokens` **excludes** cached tokens (they are the tokens *after* the
last cache breakpoint); total input is `cache_read + cache_creation + input_tokens`. Pricing
relative to base input: **read 0.1×, write-5min 1.25×, write-1h 2×**.

Two errors compound, on the Anthropic path only:

1. **`saturating_sub` over a number that already excluded the cache.** On the documentation's own
   example (100 000 read / 0 write / 50 input), `50.saturating_sub(100_000)` = **0**. The fifty
   genuinely uncached tokens are priced at zero. Under high cache hit rates, which is the normal
   case (the `codex-prompt-caching-threshold` memory records 84% measured), uncached input is
   priced at zero *always*.
2. **Cache writes priced at 0.1× when they cost 1.25× or 2×**, a 12.5× to 20× underestimate on
   that component.

The OpenAI path is correct: `prompt_tokens` *includes* cached tokens, so the subtraction holds, and
OpenAI charges no write surcharge.

**The root cause is one sentence.** `ingest_anthropic_usage` and `ingest_openai_usage` correctly
parse **two different accounting models** into **one shared struct**, and the struct's shape
silently encodes OpenAI's model ("cached is a subset of input"). Anthropic's model ("cached is
disjoint from input") does not fit, and the sum plus `saturating_sub` is where the mismatch goes to
die: no error, no log, no test.

This is the strongest argument for the laboratory. Budget policy was about to be built on these
numbers, and nothing would have objected, because **no bench asserts cost accounting**. `agent-bench`
asserts token *counts* against a mock with known counts, never the *price* derived from them.

## Prior art — what the field already settled, and where it is silent

Curated at the operator's instruction ("consolidar e curar pesquisa sobre o assunto, fora e dentro
do projeto... precisamos dar o exemplo de outros benchs por aí"). Adopt where a standard exists;
contribute only where it does not.

**OpenTelemetry GenAI semantic conventions** ([registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/),
[overview](https://opentelemetry.io/blog/2026/genai-observability/)) has been developed by the
GenAI SIG since 2024, and is still pre-1.0. refarm's usage record maps almost 1:1 onto it with home-grown names:

| refarm today | OTel GenAI |
| --- | --- |
| `tokens_in` | `gen_ai.usage.input_tokens` |
| `tokens_out` | `gen_ai.usage.output_tokens` |
| `tokens_reasoning` | `gen_ai.usage.reasoning.output_tokens` |
| `tokens_cached` | `gen_ai.usage.cache_read.input_tokens` **and** `gen_ai.usage.cache_creation.input_tokens` |
| `provider`, `model` | `gen_ai.provider.name`, `gen_ai.request.model` |

The standard is **silent on wall-clock budget**. `gen_ai.request.max_tokens` is a *generation* cap,
not a deadline. What killed the agent at 4/25 has no name in the convention, so the deadline
vocabulary is refarm's to define under `refarm.*`, and is the part worth contributing back.

**Budget-aware agent literature.** [BAGEN](https://arxiv.org/html/2606.00198v1) and
[AlloBench](https://arxiv.org/html/2607.23332) measured that *budget awareness does not correlate
with task performance, and models are universally too optimistic: they underestimate the remaining
budget.* This changes the design: "whoever spawns declares" is necessary but **not sufficient**,
because when the spawner is an agent it will lowball. The **default and the ceiling must come from
history**, not from the declarer's opinion. The operator's instinct, that a knob without data is
worthless, has third-party measurement behind it.

**Benchmark reproducibility ≠ workflow reproducibility.** The
[LLM-agent evaluation survey](https://arxiv.org/html/2507.21504v1) draws the distinction: a
benchmark can make the external environment resettable while leaving the agent's **internal
execution structure implicit**. That is precisely refarm's position. `agent-bench` already resets
the environment (deterministic mock with known counts) and records nothing about *why* a run stopped
where it did.

**Execution lineage.** [From Agent Loops to Deterministic Graphs](https://arxiv.org/pdf/2605.06365)
enumerates what must be captured to reproduce a run: per-step inputs and outputs, model invocations
with their parameters, tool calls, decision points, timestamps and sequencing, and environmental
state, plus a registry that makes lineage re-executable. The record shape below is scoped to the
budget question, but is named so those fields can be added without renaming what exists.

## The design — four layers

```
1. DECLARATION  budget-contract-v1 — the spawner declares, the node clamps
2. RECORD       BudgetObservation CRDT node — the parameter that ruled, and the outcome
3. BENCH        declared scenarios, swept across budgets, baseline + threshold
4. GALLERY      lab-contract-v1 dataset + hashes — what a third party re-runs
```

Layer 1 is the instrument's **knob**; layer 2 its **notebook**; layer 3 its **bench**; layer 4 its
**publication**. Without 1 you cannot sweep; without 2 the sweep explains nothing; without 3 it is
not reproducible; without 4 nobody but the operator can reproduce it.

### D1 — The spawner declares, the node clamps

`packages/budget-contract-v1` (the house pattern: contract + conformance suite).

```ts
type BudgetDeclaration = {
  deadlineMs?: number;
};
```

The dispatch request carries an optional budget. The node resolves it exactly as the prompt path
already does: `declared.unwrap_or(DEFAULT).min(MAX)`. The environment variables survive **in the
role they already play for prompts**: default and ceiling, never the value.

Only `deadlineMs` ships. Token and currency budgets are deliberately out of scope until the record
says what they should be. Declaring them now would be inventing numbers, which is the failure this
design exists to prevent.

### D2 — One record shape for field use and for the bench

A `BudgetObservation` node, written beside `UsageRecord` in the CRDT store. OTel vocabulary where
the standard speaks; `refarm.*` only where it is silent.

| Field | Source |
| --- | --- |
| `effort_id`, `prompt_ref` | joins that already exist |
| `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.agent.name` | OTel |
| `gen_ai.usage.{input,output}_tokens`, `gen_ai.usage.reasoning.output_tokens` | OTel |
| `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens` | OTel; the two fields split in slice 1 |
| `refarm.budget.deadline_ms.declared` / `.effective` | ours; OTel has no deadline |
| `refarm.budget.source` | `declared` \| `default` \| `ceiling` |
| `refarm.budget.spawner` | reuses `Effort.source` (`sidecar/mod.rs:133`) |
| `refarm.workspace.id` | the label the operator asked for, from the declared operation's own id when the effort is an operation, omitted otherwise (D6) |
| `refarm.outcome` | `done` \| `failed` \| `timed-out` \| `cancelled` |
| `refarm.outcome.steps_completed` / `.steps_planned` | ours; this is how "4/25" becomes data |
| `refarm.elapsed_ms`, `refarm.cost.estimated_usd` | derived |
| `refarm.scenario.id` / `.hash` | **null in field use**, set on the bench |

**The property that makes the laboratory permanent rather than a study:** the node has the *same
shape* whether it came from Termux at 7am or from a synthetic sweep. Both land in one table,
distinguished only by `scenario.id`. Real life never stops feeding the instrument.

### D3 — Record everything, labelled; publish the bench, aggregated

The operator's decision, verbatim: *"grava tudo, imagino que rótulos sejam importantes, como o
workspace, a bancada publicada agregado e nós vamos entendendo onde cultivar anonimização
reusável."*

- **Store**: every run, field and bench alike, carrying `refarm.workspace.id`,
  `refarm.budget.spawner` and `refarm.scenario.id`. Sovereign CRDT, replicated across the operator's
  own mesh, leaving no device.
- **Publish**: only runs with a `scenario.id`, and only **aggregated**: distributions, percentiles,
  completion rates. Never row-level, never field use.
- **Anonymisation**: *not built now.* It is cultivated under real second-consumer pressure, the way
  every generic block in this repo has been. What this design owes it is a boundary that can move
  later without a rewrite: publication filters on `scenario.id`, so widening the filter is the only
  edit an anonymisation layer would need.

### D4 — The clamp is never silent

The observation records `declared` **and** `effective`. A spawner that asked for more than the
ceiling can see, in the data, that it was cut, and by how much. A ceiling that is being hit
constantly is exactly the evidence needed to raise it, and it must not be invisible.

### D5 — Evidence is best-effort; work is not

A failure to write a `BudgetObservation` must never fail, delay, or alter the run it observes. The
instrument may lose a data point; it may not cost the operator an operation.

### D6 — Absent is not zero, and zero is not absent

A provider that reports no cache fields records **zero**, explicitly. An observation that could not
determine a field omits it. Aggregation over a mixture of "no cache" and "unknown" silently
averages a lie, and the gallery would publish it.

### D7 — Each provider's accounting model is honoured separately

The shared `UsageTotals` struct stops encoding one provider's model. `cache_read` and
`cache_creation` become distinct fields end to end, and the estimator applies each provider's own
rule: for Anthropic, total input is the sum of three fields and writes carry a surcharge; for
OpenAI, cached tokens are a subset of `prompt_tokens` and there is no write surcharge.

Test vectors come from the vendors' own documentation: Anthropic's `100 000 / 0 / 50` example is a
literal test case.

### D8 — A scenario is a declaration, not code

Bench scenarios are declared files, in `agent-bench`'s established shape (real `agent.wasm` via the
tractor `PluginHost`, deterministic mock with known counts, baseline JSON + percentage threshold,
`turbo run bench:check`). A third party writes *their own* scenario without touching refarm's
source, which is what the operator asked for: *"permita outros reproduzir ou até criar seus
cenários para entender o real orçamento das coisas."*

The new metric family is not token count but **completion rate under budget**: the same scenario run
across a sweep of deadlines, reporting where completion collapses. That is the AlloBench-shaped
question asked of refarm's own agent.

## Slices

Each slice is atomic, independently verifiable, and leaves the tree green.

1. **Split the cache accounting.** `cache_read` and `cache_creation` become distinct fields from
   ingestion to estimate; the estimator honours each provider's model. Vendor-documented test
   vectors. *No new capability. It makes every number after it true.*
2. **`packages/budget-contract-v1`.** Types + conformance suite, the house pattern. No wiring yet.
3. **The knob.** Dispatch accepts a declared budget; the node clamps; env becomes default+ceiling.
   Protected surface: `packages/tractor/**`.
4. **The record.** `BudgetObservation` written on every terminal effort, with the labels of D2 and
   the guarantees of D4/D5/D6.
5. **Read it back.** A command that reports observations, the operator's own first consumer, and
   the check that the join actually joins.
6. **The sweep.** Bench scenarios run across N deadlines; baseline + threshold; `bench:check`.
7. **The gallery.** `lab-contract-v1` dataset export with `exportHashes` + notebook. Aggregate only,
   filtered on `scenario.id`.
8. **Close the loop.** The default and ceiling stop being constants and start being derived from the
   record. The first policy the laboratory pays for, and the proof the instrument works.

Slices 1–5 are usable on their own: after 5, every real run the operator does from any surface is
evidence. Slices 6–8 are what let anyone else reproduce it.

## Open questions

- **Where does `steps_planned` come from?** `steps_completed` is observable from the agent's own
  loop, but a planned total exists only when the agent declared a plan (`agent/src/plan.rs`). Runs
  without a plan record `steps_completed` and omit the total, per D6. Whether the agent should
  always declare an intended step count is a question for the record to answer, not for this design
  to assume.
- **Does the ceiling belong to the node or to the workspace?** D1 keeps it on the node, matching the
  prompt path. A workspace-scoped ceiling ("professional operations may run longer than personal
  ones") is plausible and deliberately deferred until the record shows it is needed.
- **Cost of the record at high frequency.** One node per terminal effort is cheap; one per LLM call
  would not be. This design writes at effort granularity and joins to the existing per-call
  `UsageRecord` rather than duplicating it.

## What this unblocks

The operator's stated goal is refarm as an operational driver across Termux, PWA and Telegram. All
three are **spawners**, and a Telegram bot dispatching an investigation and a phone running a
three-second check have legitimately different budgets. With the ceiling read at boot, every surface
inherits whoever started the daemon. Growing surfaces over a global budget multiplies the defect per
surface, so this is base, not feature.

It also gives the convergence its own instrument. The operator's measure of convergence is a **cost
curve**: the first declared operation cost ~15 refarm fixes; it has arrived when the Nth costs zero.
That curve is currently felt rather than counted. A record that survives the run is the first thing
in this repository that could count it.
