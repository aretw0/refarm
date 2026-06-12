# Extension Sandbox PoC

This validation is a small, synthetic, local-only proof of a minimum extension
host policy flow.

It answers one question:

> Can a local host validate extension manifests, enforce explicit capability
> grants, record lifecycle events, and handle failures according to policy?

## Scope

The PoC uses only fictitious extension IDs and synthetic lifecycle events. It
does not load real plugins, call external services, use institutional data, or
read secrets.

## What It Demonstrates

- A benign extension manifest validates and completes `setup -> ingest -> teardown`.
- A denied extension is blocked when it requires a capability outside the grant.
- `warn+continue` isolates a failing extension and lets the host continue.
- `fail-fast` aborts the host flow on extension failure.
- A policy decision artifact records denied capabilities, isolated failures,
  and whether human review is required before changing grants.
- A risk and standards matrix records alignment, controls, gaps, and no
  conformance claim.
- A runtime evidence artifact links this synthetic policy POC to the dedicated
  real WASM build and browser lifecycle validation path.
- A limits report records non-claims, adoption risks, and promotion criteria.
- JSON and Markdown reports are generated deterministically.
- A `refarm.task-artefacts.v1` manifest lists generated outputs with media
  types, SHA-256 hashes, review state, and provenance.

## What It Does Not Demonstrate

- Real WebAssembly execution inside this synthetic policy report.
- Browser runtime descriptor installation.
- Production plugin governance.
- Performance of a real host or plugin.
- Complete capability enforcement across all Refarm runtimes.

## Run

From the repository root:

```bash
pnpm run extension-sandbox:poc:test
```

To regenerate the expected synthetic artifacts:

```bash
pnpm run extension-sandbox:poc
```

## Success Criteria

- Benign extension lifecycle produces three ordered events.
- Missing capabilities are detected before lifecycle execution.
- Tolerant and strict policy modes produce different host outcomes.
- Policy decisions are explicit enough for downstream review without reading
  the full lifecycle report.
- The report does not contain real project, operator, service, or secret data.
- `fixtures/expected/task-artefacts.json` describes the generated reports.

## Artifacts

Expected artifacts live in `fixtures/expected/`:

- `sandbox-report.json`
- `policy-decision.json`
- `scorecard.json`
- `risk-and-standards-matrix.json`
- `runtime-evidence.json`
- `sandbox-report.md`
- `scenario.md`
- `annex.md`
- `limits.md`
- `task-artefacts.json`

## Next Steps

- Connect this report shape to a real plugin lifecycle smoke once the cheapest
  reproducible path is stable across Linux, macOS, and Windows.
- Add a real denied-manifest fixture from `@refarm.dev/plugin-manifest` when the
  policy surface becomes shared beyond this validation.
- Let downstream docs or labs consume `task-artefacts.json` instead of
  hard-coding generated file names.
