# The budget belongs to whoever spawns, and the evidence outlives the run

Date: 2026-08-03
Status: DESIGN — approved by the operator through brainstorming, then revised the same day when the
operator widened D1 to three axes and settled the nesting as D9. Awaits the implementation plan.
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

### F6 — The token axis already exists, and is already wrong the same way

`agent/src/runtime/policy.rs:10` reads `MODEL_MAX_CONTEXT_TOKENS` from the environment and blocks a
run that exceeds it. It is the deadline's defect in a second body: read from a process global, not
declarable per dispatch, and measured on *estimated prompt size* (`prompt.len() / 4`) **before** the
run rather than on cumulative usage **across** it. A run that starts under the ceiling and then burns
ten times it in tool loops is never stopped.

So the token budget is not a new axis this design invents. It is an axis that already exists,
already governs real runs, and already has the shape this document is correcting.

The same file's tests pin the defect of F5 as intended behaviour.
`tests/runtime_cost_guard_tests.rs::estimate_usd_sonnet_with_cache_discount` asserts that 1000 input
with 200 cached bills 800 at full rate — the OpenAI subset model, asserted as a universal rule
against a Claude model id. **The test is not wrong about the code; the code is wrong and the test
agrees with it.** Fixing F5 means changing that test, and the change is the point rather than
collateral.

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

**Nested resource governance is a solved problem, and the solution is not from this field.** The
operator asked whether someone had already built what ought to be canonical. Kubernetes did, a decade
ago, and it uses **two objects rather than one**:
[ResourceQuota](https://kubernetes.io/docs/concepts/policy/resource-quotas/) constrains *aggregate*
consumption per namespace, and [LimitRange](https://www.kubernetes.io/docs/concepts/policy/limit-range/)
sets per-object minimum, maximum and **default**, injected by an admission controller when the object
declares nothing. The documented best practice is the pairing itself: quotas for namespace budgeting,
limit ranges so objects without explicit resources get defaults.

That is the operator's own sentence in someone else's vocabulary — the node limits to what it can
serve, the workspace limits other things within that, and everyone has to be a good citizen. "Good
citizen" is called *admission control* there. D9 adopts the two-level structure and the defaulting
rule; it does not adopt the YAML, the object model, or the controller.

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
  maxTokens?: number;
  maxUsd?: number;
};
```

The dispatch request carries an optional budget. The node resolves each axis exactly as the prompt
path already does: `declared.unwrap_or(DEFAULT).min(MAX)`. The environment variables survive **in
the role they already play for prompts**: default and ceiling, never the value.

**All three axes ship in the declaration; they do not all enforce the same way**, and the record must
say which was which, or an unenforced ceiling reads as a satisfied one.

| Axis | Enforcement point | This program |
| --- | --- | --- |
| `deadlineMs` | the terminal-result watcher (`dispatch.rs:701`) already polls to a deadline | **enforced** |
| `maxTokens` | `runtime/policy.rs:10` already blocks on a token ceiling, but on estimated *prompt size* before the run rather than cumulative usage across it (F6) | **enforced**, after moving the check to cumulative |
| `maxUsd` | derives from tokens times a rate table, at the same point as `maxTokens` | **enforced only in `api` pricing mode** |

The `maxUsd` restriction is not timidity. `pricing_mode_for_provider` (`agent/src/utils.rs:12`) returns
`subscription` for `openai-codex` and `github-copilot` and `local` for `ollama`, and
`estimate_billable_usd` returns `0.0` for all of them. A currency ceiling over a structural zero is a
ceiling that can never bind, and enforcing one would teach the operator to trust a guard that is not
guarding. In those modes `maxUsd` is recorded as declared, reported as `not-applicable`, and the
token ceiling is what actually holds the line.

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
| `refarm.budget.max_tokens.declared` / `.effective` | ours; the axis F6 shows already exists |
| `refarm.budget.max_usd.declared` / `.effective` | ours; the value resolved, whether or not it can bind |
| `refarm.budget.max_usd.enforced` | ours; `false` outside `api` pricing mode, where the estimate is a structural zero (D1) |
| `refarm.pricing_mode` | `api` \| `subscription` \| `local` — the fact `max_usd.enforced` derives from |
| `refarm.budget.bound_by` | `node` \| `workspace` \| `declared` \| `default` — which level bound the run (D9) |
| `refarm.budget.spawner` | reuses `Effort.source` (`sidecar/mod.rs:133`) |
| `refarm.workspace.id` | the label the operator asked for, from the declared operation's own id when the effort is an operation, omitted otherwise (D6) |
| `refarm.outcome` | `done` \| `failed` \| `timed-out` \| `cancelled` |
| `refarm.outcome.steps_completed` / `.steps_planned` | ours; this is how "4/25" becomes data |
| `refarm.elapsed_ms`, `refarm.cost.estimated_usd` | derived |
| `refarm.scenario.id` / `.hash` | **null in field use**, set on the bench |

**Every field above is a top-level key on the node, flat.** The `gen_ai.*` values are joined in from
the run's `UsageRecord` and written out beside the budget fields, not nested under an opaque `usage`
object. A dataset consumer reading `gen_ai.usage.input_tokens` is reading the standard's own name at
the path the standard implies, which is the entire point of adopting the vocabulary. A nested blob
would make the OTel alignment decorative.

**`refarm.budget.source` was removed on 2026-08-03.** It predated D9 and answered the same question
`bound_by` now answers, with a vocabulary (`declared | default | ceiling`) that no longer matches
reality: after D9 there is no single "ceiling", there is a node one and a workspace one, and saying
which is the whole value of the field. Two fields answering one question is how they drift apart.

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

### D9 — Ceilings nest: the node bounds what it can serve, the workspace bounds within that

The operator's decision, and the resolution of what this design had left open:

> "o teto pertence ao nó e workspace, faz sentido o nó limitar para o que ele consegue atender e o
> workspace outras coisas dentro disso... todos precisam ser sensatos e serem bons cidadãos."

Three levels, resolved outward to inward, adopting the Kubernetes structure named in *Prior art*:

| Level | Question it answers | Analogue |
| --- | --- | --- |
| **Node** | what this machine can serve at all | cluster capacity |
| **Workspace** | what this workspace may consume within that | ResourceQuota |
| **Dispatch** | what this spawner asked for, defaulted and clamped | LimitRange + admission |

Resolution is a fold, per axis: `effective = min(node_ceiling, workspace_ceiling, declared ?? workspace_default ?? node_default)`.

Two rules keep it honest. A workspace ceiling **above** the node's is not an error and not silently
obeyed — it is clamped to the node's, because a workspace cannot grant capacity the machine does not
have. And the observation records **which level bound the run** (`refarm.budget.bound_by`:
`node` | `workspace` | `declared` | `default`), because "it was cut" without "by whom" sends the
operator to raise the wrong ceiling.

This is where the personal-versus-professional boundary the operator already maintains becomes
enforceable rather than merely intended: a professional workspace may be allowed to run longer than a
personal one, declared per workspace, and neither can exceed what the node can serve.

## Slices

Each slice is atomic, independently verifiable, and leaves the tree green.

1. **Split the cache accounting.** `cache_read` and `cache_creation` become distinct fields from
   ingestion to estimate; the estimator honours each provider's model. Vendor-documented test
   vectors, including the correction of the test that pinned the defect (F6). *No new capability. It
   makes every number after it true.*
2. **`packages/budget-contract-v1`.** The three-axis declaration, the three-level resolution fold of
   D9, and the conformance suite, in the house pattern. Pure functions, no wiring yet.
3. **The knob.** Dispatch accepts a declared budget and resolves it through D9; env becomes
   default+ceiling at the node level; `MODEL_MAX_CONTEXT_TOKENS` moves from prompt-size gate to
   cumulative token ceiling (F6). Protected surface: `packages/tractor/**`.
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
- ~~**Where does a workspace declare its ceiling?**~~ **Settled 2026-08-03 by the operator: a budget
  is policy, and policy sits beside policy.** The framing that produced this question was wrong: it
  offered two homes where the sovereign config is the only one. Measured: `.refarm/config.json`
  carries `tractor`, `processes`, `surfaces`, `workspaces`, `spawnEnv` and `delivery` at the top
  level, and the auth gate lives at `surfaces.<name>.gate` — **keyed by the thing it governs, not by
  the workspace**. A workspace cannot declare its own auth policy today; that is a limitation of the
  present shape, not a principle.

  So `budget` becomes a **top-level section** carrying `node` (the machine's default and ceiling) and
  a `workspaces` map for those needing their own. Not `workspaces.<id>.budget`: that section
  describes *capacity* (where the workspace is, what commands it exposes, how it executes), so a
  ceiling filed there reads as something the workspace *does* rather than what it may *spend*.
  `surfaces` already demonstrates the right shape.
- **The fourth axis, and the consumer that will demand it.** D1 declares three axes: wall-clock
  deadline, cumulative tokens, estimated spend. GitHub Copilot is already known to this repository
  (`SUBSCRIPTION_MODEL_PROVIDERS` lists it, it has an env key and a default model) and deliberately
  blocked from running: `RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS` contains only `openai-codex`, and
  `provider_config.rs` gives it no base URL. What is missing is a Rust route and a GitHub OAuth device
  flow.

  When it lands, it will not fit any of the three axes. Its binding constraint is neither time nor
  tokens nor dollars but **requests per billing period, a quota that refills**, and the whole point
  of running work there is to spend quota that would otherwise idle. So the laboratory cannot today
  express the budget that matters for its most likely second consumer.

  This is recorded rather than built, on the repository's own discipline: assimilate a generic
  capability under real second-consumer pressure, not before. Inventing a quota axis now would be the
  placeholder problem inside a versioned contract, which is the more expensive place to be wrong.
  `BudgetDeclaration`'s fields are all optional, so a fourth axis is additive when the pressure is
  real. Settled with the maintainer on 2026-08-03: Copilot gets its own spec after this program, and
  the fourth axis is designed from its pain rather than ahead of it.

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
