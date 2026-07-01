# Verification As Completion Proof

This proof turns the peerd/RTK/Terax lessons into a small Refarm-native
evidence loop:

- a compact tool observation is useful, but is not truth;
- raw evidence remains recoverable as an artifact pointer;
- completion is allowed only after the observed source hash matches the
  source-of-truth hash;
- the key-holding orchestrator delegates environment tools to a keyless actor;
- `context:v1` remains the existing `@refarm.dev/context-provider-v1` home for
  reversible folds and visible context maps.

Boundary: this is proof-local. It does not extract `tool-observation:v1`, change
`effort-contract-v1`, publish a package, or add app-owned runtime behavior.

Run:

```bash
pnpm run verification-completion:poc:test
```
