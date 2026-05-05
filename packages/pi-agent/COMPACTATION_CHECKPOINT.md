# Compactation Checkpoint — `packages/pi-agent`

> Last validated code commit before this checkpoint refresh: `3d67abd5`  
> Validation used during this lote: `CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo check --target wasm32-wasip1 && CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo test --lib`  
> Result: wasm check **pass**, lib tests **213/213 pass**.

## 1) Purpose
This file is the context-compaction handoff for the Rust modularization of `packages/pi-agent`. It records current provider-runtime boundaries, invariants, validation discipline, and safe continuation steps.

## 2) Current provider runtime architecture
`src/provider_runtime.rs` remains a façade/re-export module. Runtime behavior is split into focused submodules under `src/provider_runtime/`:

- `anthropic_phase.rs` — Anthropic response content extraction, tool-use parsing, termination text guard, and phase shape.
- `openai_phase.rs` — OpenAI-compatible message/tool-call extraction, argument parsing, termination text guard, and phase shape.
- `phase_common.rs` — shared phase helpers: JSON argument fallback, tool-loop termination gate, completion-text gate, error-message extraction.
- `contracts.rs` — response/phase + iteration contracts and contract-native step adapter.
- `contract_loop.rs` — dispatch-capable contract-primitives loop orchestration helpers.
- `contract_loop_tests.rs` — test-only non-dispatch/context contract-loop adapters.
- `state_adapters.rs` — test-only state adapter primitives over the contract seam.
- `state_loop_tests.rs` — test-only state-loop orchestration adapters.
- `state_primitives.rs` — production state-primitives dispatch orchestration layered on contracts.
- `loop_dispatch.rs` — dispatch-injectable common-config loop scaffolding.
- `loop_config.rs` — loop state/plan/config structs and `tool_loop_max_iter`.
- `loop_runner_config.rs` — provider runner config builders and provider loop plan/state builders.
- `loop_core.rs` — generic completion loop runner, plan runner, and `CompletionLoopOutcome`.
- `request_builders.rs` — provider headers, OpenAI-compatible path selection, request body builders, and JSON response parsing.
- `request_flow.rs` — generic response+phase helper.
- `request_wasm.rs` — wasm HTTP request execution plus provider response+phase request flow.
- `wire_bootstrap.rs` — Anthropic/OpenAI initial wire-message builders.
- `tool_execution.rs` — generic tool execution for parsed provider calls.
- `tool_recording.rs` — executed-call schema plus provider-specific execution recording.
- `tool_wire.rs` — tool-result and tool-message wire JSON builders.
- `tool_phase_common.rs` — generic tool-phase append/execute/append pipeline primitive.
- `anthropic_tool_phase.rs` — Anthropic tool-phase advancement helpers.
- `openai_tool_phase.rs` — OpenAI-compatible tool-phase advancement helpers.
- `step_common.rs` — generic step terminate/advance primitive.
- `anthropic_step_phase.rs` — Anthropic step text/advance + dispatch adapter.
- `openai_step_phase.rs` — OpenAI-compatible step text/advance + dispatch adapter.
- `usage_totals.rs` — usage totals and Anthropic/OpenAI usage accumulation methods.
- `usage_phase.rs` — response usage extraction, usage ingest helpers, and phase-after-usage combiners.
- `usage_finalize.rs` — wasm completion-result finalization.
- `output_dedup.rs` — tool-output deduplication and wasm dispatch+dedup adapter.
- `wasm_loop.rs` — wasm finalization adapter over state-primitives loop outcome.
- `wasm_anthropic.rs` — wasm Anthropic completion runner façade.
- `wasm_openai.rs` — wasm OpenAI-compatible completion runner façade.

Removed/renamed during latest lote:

- `tool_phase.rs` was split into `anthropic_tool_phase.rs` + `openai_tool_phase.rs`.
- `step_phase.rs` was split into `anthropic_step_phase.rs` + `openai_step_phase.rs`.

## 3) Invariants currently protecting behavior
Provider runtime tests enforce:

- dispatch vs non-dispatch equivalence across contract/state paths;
- max-iteration termination equivalence;
- response/step error propagation equivalence;
- response errors do not execute step functions;
- wire-shape compatibility for Anthropic/OpenAI messages, tool calls, usage, and finalization;
- shared request/phase/tool primitives remain behavior-compatible through façade re-exports.

## 4) Disk/storage discipline
`/workspaces/refarm` is on a nearly-full mount. Keep validation artifacts out of the workspace:

```bash
cd packages/pi-agent
CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo check --target wasm32-wasip1
CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo test --lib
rm -rf /tmp/refarm-pi-agent-target
```

Avoid broad builds, full `cargo test`, or generated artifact churn in `/workspaces/refarm/target` while disk pressure remains.

## 5) Most recent commits in this lote
- `3d67abd5` refactor(pi-agent): split tool execution recording
- `0aa3430d` refactor(pi-agent): split provider step phase modules
- `747dc5c6` refactor(pi-agent): split provider tool phase modules

Earlier relevant commits:
- `c5d6bc65` docs(pi-agent): refresh provider runtime split checkpoint
- `0b3b0566` refactor(pi-agent): split generic tool phase primitive
- `cd13ee58` refactor(pi-agent): split wasm request flow
- `857ef38f` refactor(pi-agent): split usage totals primitive
- `f6108043` refactor(pi-agent): split generic step advance primitive
- `79296b4d` refactor(pi-agent): split provider runner config builders
- `fae863f7` refactor(pi-agent): split contract loop test adapters

## 6) Safe continuation plan
1. Keep `provider_runtime.rs` as a façade; do not reintroduce runtime logic there.
2. Continue only behavior-preserving splits with façade re-exports kept stable.
3. Good next targets if continuing compactation:
   - split test-only shims from `loop_dispatch.rs`;
   - split `state_loop_tests.rs` by dispatch/non-dispatch if useful;
   - normalize façade grouping and cfg gates after all physical splits settle;
   - consider README/ROADMAP wording cleanup once module churn slows down.
4. Run wasm check + lib tests after each atomic slice.
5. Commit each green slice with concise Conventional Commit messages.

## 7) Current posture
- Branch observed during this lote: `develop...origin/develop` ahead by 137 commits after `3d67abd5`.
- No push has been performed.
- Last observed provider runtime façade size: ~186 lines.
