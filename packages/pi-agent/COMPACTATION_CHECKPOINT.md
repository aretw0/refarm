# Compactation Checkpoint — `packages/pi-agent`

> Last validated commit: `388704ba`  
> Validation at checkpoint: `CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo test --lib` (**213/213 pass**), `CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo check --target wasm32-wasip1` (**pass**)

## 1) Why this file exists
This is the compact handoff artifact for context compaction. It preserves the current architecture, invariants, validation commands, and safe next steps.

## 2) Current architectural state
`src/provider_runtime.rs` is now a thin façade/re-export module (~136 lines). The provider runtime is physically split into focused submodules under `src/provider_runtime/`:

- `contracts.rs` — response/phase + iteration contracts and contract-native step adapter.
- `contract_loop.rs` — contract-primitives loop orchestration helpers.
- `state_primitives.rs` — compatibility/state adapters layered over contract primitives.
- `loop_dispatch.rs` — dispatch-injectable common-config loop scaffolding.
- `loop_config.rs` — loop state/plan/config structs, runner configs, and `tool_loop_max_iter`.
- `loop_core.rs` — generic completion loop runner, plan runner, and `CompletionLoopOutcome`.
- `request_flow.rs` — headers/path/body builders, JSON response parsing, wasm request/response+phase flow.
- `wire_bootstrap.rs` — Anthropic/OpenAI initial wire-message builders.
- `phase_primitives.rs` — response phase parsing, content guards, termination gates, error extraction, JSON argument parsing.
- `tool_phase.rs` — tool execution, executed-call recording, wire-message appenders, and phase advancement.
- `step_phase.rs` — step terminate/advance helpers and provider-specific step dispatch adapters.
- `usage_phase.rs` — response usage extraction, usage ingest helpers, and phase-after-usage combiners.
- `usage_finalize.rs` — usage totals and completion result finalization.
- `output_dedup.rs` — tool-output deduplication and wasm dispatch+dedup adapter.
- `wasm_runners.rs` — wasm-facing Anthropic/OpenAI completion loop runners.

## 3) Stability invariants enforced by tests
In `src/tests/provider_runtime_tests.rs`:

- Dispatch vs non-dispatch equivalence invariants (contract vs state paths).
- Max-iter termination equivalence invariants.
- Error propagation equivalence invariants.
- No-step-on-response-error invariants.
- Provider wire-shape tests for Anthropic/OpenAI builders, phases, tool messages, usage, and finalization.

These invariants are the safety net for continuing compactation without behavior drift.

## 4) Validation discipline
The workspace filesystem is almost full on `/workspaces/refarm`, so use `/tmp` for Cargo artifacts during validation:

```bash
cd packages/pi-agent
CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo test --lib
CARGO_TARGET_DIR=/tmp/refarm-pi-agent-target CARGO_INCREMENTAL=0 cargo check --target wasm32-wasip1
```

Avoid broad builds or commands that write large artifacts into `/workspaces/refarm/target` while disk is tight.

## 5) Recent commits (most relevant)
- `388704ba` refactor(pi-agent): move tool loop limit into loop config
- `71c90115` refactor(pi-agent): split tool output dedup module
- `e629e0c4` refactor(pi-agent): split completion loop core module
- `9540d53c` refactor(pi-agent): split step and usage phase primitives
- `c777c4aa` refactor(pi-agent): split phase parsing and termination primitives
- `721e5643` refactor(pi-agent): split initial wire message bootstrap module
- `728c5865` refactor(pi-agent): split request and response flow module

## 6) Safe next steps
1. Keep `provider_runtime.rs` as a façade; avoid reintroducing logic there.
2. Consider light façade hygiene only: reorder/group re-exports, add short module comments, or narrow `cfg` re-exports if warnings appear.
3. If continuing feature work, preserve the contract-first seam and keep providers as thin façades.
4. Run both validation commands after each atomic slice.
5. Do not start large feature work until disk pressure is addressed or validation consistently uses `/tmp` target artifacts.

## 7) Current branch posture
- Branch observed: `develop...origin/develop` ahead by more than 113 commits.
- No push has been performed.
- Last checked source façade size: `packages/pi-agent/src/provider_runtime.rs` ~136 lines.
