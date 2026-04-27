# Compactation Checkpoint — `packages/pi-agent`

> Last validated commit: `3308a7b3`  
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
1. **Extract internal module boundaries** (same crate, no API change):
   - contracts
   - contract/state adapters
   - loop orchestrators
2. **Move code physically** from `provider_runtime.rs` into submodules with `pub(crate)` re-exports.
3. Keep wrappers only where needed for compatibility/tests; remove redundant adapters after parity checks.

## 5) Rules while compacting
- No wire-format behavior changes.
- No provider semantic changes (Anthropic/OpenAI paths must remain equivalent).
- Run both validations after each slice:
  - `cd packages/pi-agent && cargo test --lib`
  - `cd packages/pi-agent && cargo check --target wasm32-wasip1`
- Update `README.md` and `ROADMAP.md` in every atomic slice.

## 6) Recent commits (most relevant)
- `3308a7b3` refactor(pi-agent): add non-dispatch common-config contract helper
- `8ab44c37` test(pi-agent): enforce no-step-on-response-error invariants
- `467a6634` test(pi-agent): add error-propagation equivalence invariants
- `41ba3985` test(pi-agent): add max-iter termination equivalence invariants
- `6a55197a` test(pi-agent): add contract-vs-state loop equivalence invariants
- `8716ad32` refactor(pi-agent): add non-dispatch context contract loop helper
- `168d118b` refactor(pi-agent): make step contract adapter contract-native
- `15543ca2` refactor(pi-agent): add context-aware contract loop primitive

## 7) When to resume "new features"
After compactation, resume new feature work only when:
- split is complete,
- invariants remain green,
- and at least one dogfood self-change flow (task→patch→validate) succeeds end-to-end.
