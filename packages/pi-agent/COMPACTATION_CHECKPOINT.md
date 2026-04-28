# Compactation Checkpoint — `packages/pi-agent`

> Last validated code commit before this checkpoint refresh: `0b3b0566`  
> Validation used during this lote: `CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo check --target wasm32-wasip1 && CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo test --lib`  
> Result: wasm check **pass**, lib tests **213/213 pass**.

## 1) Purpose
This file is the context-compaction handoff for the Rust modularization of `packages/pi-agent`. It records the current provider-runtime boundaries, invariants, validation discipline, and safe continuation steps.

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
- `tool_execution.rs` — generic tool execution, provider-specific execution recorders, and executed-call shape.
- `tool_wire.rs` — tool-result and tool-message wire JSON builders.
- `tool_phase_common.rs` — generic tool-phase append/execute/append pipeline primitive.
- `tool_phase.rs` — provider phase-advancement helpers for Anthropic/OpenAI tools.
- `step_common.rs` — generic step terminate/advance primitive.
- `step_phase.rs` — provider-specific step dispatch adapters.
- `usage_totals.rs` — usage totals and Anthropic/OpenAI usage accumulation methods.
- `usage_phase.rs` — response usage extraction, usage ingest helpers, and phase-after-usage combiners.
- `usage_finalize.rs` — wasm completion-result finalization.
- `output_dedup.rs` — tool-output deduplication and wasm dispatch+dedup adapter.
- `wasm_loop.rs` — wasm finalization adapter over state-primitives loop outcome.
- `wasm_anthropic.rs` — wasm Anthropic completion runner façade.
- `wasm_openai.rs` — wasm OpenAI-compatible completion runner façade.

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
- `0b3b0566` refactor(pi-agent): split generic tool phase primitive
- `cd13ee58` refactor(pi-agent): split wasm request flow
- `857ef38f` refactor(pi-agent): split usage totals primitive
- `f6108043` refactor(pi-agent): split generic step advance primitive
- `79296b4d` refactor(pi-agent): split provider runner config builders
- `fae863f7` refactor(pi-agent): split contract loop test adapters
- `d382f436` refactor(pi-agent): rename wasm openai runner module
- `2eee4b51` refactor(pi-agent): split wasm anthropic runner
- `948024fa` refactor(pi-agent): split wasm loop finalization adapter

Earlier relevant commits:
- `5550f82d` docs(pi-agent): refresh runtime split checkpoint
- `6aba03c8` refactor(pi-agent): split request builder primitives
- `ef5939e8` refactor(pi-agent): split state loop test adapters
- `df50b6bf` refactor(pi-agent): rename openai phase module
- `15ee2c0c` refactor(pi-agent): split anthropic phase primitives
- `7aa189fe` refactor(pi-agent): split phase common primitives
- `14620c63` refactor(pi-agent): split state adapter test primitives
- `8dad231c` refactor(pi-agent): split tool execution primitives
- `ed51af08` refactor(pi-agent): split tool wire message primitives

## 6) Safe continuation plan
1. Keep `provider_runtime.rs` as a façade; do not reintroduce runtime logic there.
2. Continue only behavior-preserving splits with façade re-exports kept stable.
3. Good next targets if continuing compactation:
   - split provider-specific `tool_phase.rs` into Anthropic/OpenAI tool-phase modules;
   - split provider-specific `step_phase.rs` into Anthropic/OpenAI step modules;
   - split `loop_dispatch.rs` test-only shims from production dispatch helper;
   - normalize façade grouping and cfg gates after all physical splits settle.
4. Run wasm check + lib tests after each atomic slice.
5. Commit each green slice with concise Conventional Commit messages.

## 7) Current posture
- Branch observed during this lote: `develop...origin/develop` ahead by 133 commits after `0b3b0566`.
- No push has been performed.
- Last observed provider runtime façade size: ~181 lines.
