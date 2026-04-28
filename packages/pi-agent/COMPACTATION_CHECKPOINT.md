# Compactation Checkpoint — `packages/pi-agent`

> Last validated commit before this checkpoint refresh: `6aba03c8`  
> Validation used during this lote: `CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo check --target wasm32-wasip1 && CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo test --lib`  
> Result: wasm check **pass**, lib tests **213/213 pass**.

## 1) Purpose
This file is the context-compaction handoff for the ongoing Rust modularization of `packages/pi-agent`. It records stable module boundaries, invariants, validation discipline, and safe continuation steps.

## 2) Current provider runtime architecture
`src/provider_runtime.rs` remains a façade/re-export module. Runtime behavior is split into focused submodules under `src/provider_runtime/`:

- `anthropic_phase.rs` — Anthropic response content extraction, tool-use parsing, termination text guard, and phase shape.
- `openai_phase.rs` — OpenAI-compatible message/tool-call extraction, argument parsing, termination text guard, and phase shape.
- `phase_common.rs` — shared phase helpers: JSON argument fallback, tool-loop termination gate, completion-text gate, error-message extraction.
- `contracts.rs` — response/phase + iteration contracts and contract-native step adapter.
- `contract_loop.rs` — contract-primitives loop orchestration helpers.
- `state_adapters.rs` — test-only state adapter primitives over the contract seam.
- `state_loop_tests.rs` — test-only state-loop orchestration adapters.
- `state_primitives.rs` — production state-primitives dispatch orchestration layered on contracts.
- `loop_dispatch.rs` — dispatch-injectable common-config loop scaffolding.
- `loop_config.rs` — loop state/plan/config structs, runner configs, and `tool_loop_max_iter`.
- `loop_core.rs` — generic completion loop runner, plan runner, and `CompletionLoopOutcome`.
- `request_builders.rs` — provider headers, OpenAI-compatible path selection, request body builders, and JSON response parsing.
- `request_flow.rs` — wasm request execution and generic response+phase helper.
- `wire_bootstrap.rs` — Anthropic/OpenAI initial wire-message builders.
- `tool_execution.rs` — generic tool execution, provider-specific execution recorders, and executed-call shape.
- `tool_wire.rs` — tool-result and tool-message wire JSON builders.
- `tool_phase.rs` — generic tool-phase pipeline and provider phase-advancement helpers.
- `step_phase.rs` — step terminate/advance helpers and provider-specific step dispatch adapters.
- `usage_phase.rs` — response usage extraction, usage ingest helpers, and phase-after-usage combiners.
- `usage_finalize.rs` — usage totals and completion result finalization.
- `output_dedup.rs` — tool-output deduplication and wasm dispatch+dedup adapter.
- `wasm_runners.rs` — wasm-facing Anthropic/OpenAI completion loop runners.

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
- `6aba03c8` refactor(pi-agent): split request builder primitives
- `ef5939e8` refactor(pi-agent): split state loop test adapters
- `df50b6bf` refactor(pi-agent): rename openai phase module
- `15ee2c0c` refactor(pi-agent): split anthropic phase primitives
- `7aa189fe` refactor(pi-agent): split phase common primitives
- `14620c63` refactor(pi-agent): split state adapter test primitives
- `8dad231c` refactor(pi-agent): split tool execution primitives
- `ed51af08` refactor(pi-agent): split tool wire message primitives

Earlier relevant commits:
- `3640ec7c` docs(pi-agent): refresh provider runtime compactation checkpoint
- `388704ba` refactor(pi-agent): move tool loop limit into loop config
- `71c90115` refactor(pi-agent): split tool output dedup module
- `e629e0c4` refactor(pi-agent): split completion loop core module
- `9540d53c` refactor(pi-agent): split step and usage phase primitives

## 6) Safe continuation plan
1. Keep `provider_runtime.rs` as a façade; do not reintroduce runtime logic there.
2. Continue only behavior-preserving splits with façade re-exports kept stable.
3. Good next targets if continuing compactation:
   - split `wasm_runners.rs` into Anthropic/OpenAI runner modules or a shared runner adapter;
   - split `contract_loop.rs` into dispatch vs non-dispatch test helpers if warning-free;
   - normalize façade grouping and cfg gates after all physical splits settle.
4. Run wasm check + lib tests after each atomic slice.
5. Commit each green slice with concise Conventional Commit messages.

## 7) Current posture
- Branch observed during this lote: `develop...origin/develop` ahead by 123 commits after `6aba03c8`.
- No push has been performed.
- Last observed provider runtime façade size: ~163 lines.
