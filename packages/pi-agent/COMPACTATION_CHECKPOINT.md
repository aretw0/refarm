# Compactation Checkpoint — `packages/pi-agent`

> Last validated state: post-`phase_primitives.rs` + `loop_config.rs` + `tool_phase.rs` physical splits  
> Validation at checkpoint: `cargo test --lib` (**213/213 pass**), `cargo check --target wasm32-wasip1` (**pass**)

## 1) Why this file exists
This file is a compact handoff artifact to survive session/context compaction without losing architectural intent.

## 2) Current architectural state (ready for split)
`src/provider_runtime.rs` now has a clear progression toward contracts-first orchestration:

- **Contracts**
  - `ProviderResponsePhaseContract<P>`
  - `ProviderIterationContract<'_, P>`
  - `provider_response_phase_contract_into_parts(...)`
- **Contract step adapter**
  - `step_from_state_with_dispatch_contract(...)` (contract-native callback)
- **Contract orchestrators**
  - `run_completion_loop_from_common_config_with_contract_primitives_and_dispatch(...)`
  - `run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch(...)`
  - test-only non-dispatch variants:
    - `run_completion_loop_from_common_config_with_contract_primitives(...)`
    - `run_completion_loop_from_common_config_and_context_with_contract_primitives(...)`
- **State-primitives wrappers** remain for compatibility and are now layered over contract primitives.

## 3) Stability invariants already enforced by tests
In `src/tests/provider_runtime_tests.rs`:

- Dispatch vs non-dispatch equivalence invariants (contract vs state)
- Max-iter termination equivalence invariants
- Error propagation equivalence invariants
- "No step execution when response/phase fails" invariants

These cover the most regression-prone orchestration semantics and were added specifically to make compactation/splitting safe.

## 4) Next compactation slices (behavior-preserving)
1. **Continue reducing `provider_runtime.rs` surface** by extracting remaining cohesive blocks:
   - tool execution/recording + append helpers
   - step/advance adapters
2. Keep module boundaries contract-first and runtime-generic (no provider-specific duplication).
3. Keep wrappers only where needed for compatibility/tests; remove redundant adapters after parity checks.

## 5) Rules while compacting
- No wire-format behavior changes.
- No provider semantic changes (Anthropic/OpenAI paths must remain equivalent).
- Run both validations after each slice:
  - `cd packages/pi-agent && cargo test --lib`
  - `cd packages/pi-agent && cargo check --target wasm32-wasip1`
- Update `README.md` and `ROADMAP.md` in every atomic slice.

## 6) Recent commits (most relevant)
- `c777c4aa` refactor(pi-agent): split phase parsing and termination primitives
- `721e5643` refactor(pi-agent): split initial wire message bootstrap module
- `728c5865` refactor(pi-agent): split request and response flow module
- `c06c05b5` refactor(pi-agent): split usage and completion finalization module
- `19fed74f` refactor(pi-agent): split loop dispatch scaffolding module
- `f4dcede6` refactor(pi-agent): split state-primitives adapters module
- `3829ebcb` refactor(pi-agent): split contract loop orchestrators module
- `bc881ff0` refactor(pi-agent): split provider runtime contracts submodule

## 7) When to resume "new features"
After compactation, resume new feature work only when:
- split is complete,
- invariants remain green,
- and at least one dogfood self-change flow (task→patch→validate) succeeds end-to-end.
