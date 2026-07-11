# @refarm.dev/quality-checker-plugin

The `quality:v1` checker as a refarm **integration plugin** — and the **second
real consumer** of `dispatch-result:v1`, proving the async result-envelope
contract generalizes across plugin FAMILIES (quality, not vault).

## The runtime-plugin form of the quality checker

Where `@refarm.dev/quality-checker-ref` is the sandbox-by-absence WASM component
(world imports nothing, the sovereign-boundary proof), THIS package is the runtime
form: it exports the canonical `integration` interface, imports `tractor-bridge`,
and runs on the real runtime like the agent and the vault. Built from TS via
`esbuild --bundle` (inlining the reused logic, keeping `refarm:*` imports external)
then `jco componentize` — the same TS→WASM pattern as `vault-surface-ref`.

## One contract, two families

- It **reuses** `runRegexQualityRules` from `@refarm.dev/quality-contract-v1` — no
  duplicated matcher; the same logic the contract's conformance pins.
- It **emits** findings through the shared `@refarm.dev/dispatch-result-contract-v1`
  (`serializeDispatchResult`), so a caller correlates a quality result by `replyRef`
  **exactly** as it does a vault result — via `matchDispatchResults`, `@type`
  `DispatchResult`, no per-family shape to learn.

`on-event('quality:dispatch', { subject, profile, replyRef })` runs the check and
stores the correlated result node. `loadQualityPluginComponent` ships the loader (a
host or a test double supplies the `tractor-bridge`).

That two independent families (vault, quality) round-trip through the SAME
correlation contract is the validation a contract needs — a shape with one consumer
is just that consumer's code.
