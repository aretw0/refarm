# Plan: Astro WASI SSR POC (Roadmap Item 5 / ADR-070 Part C)

> ADR: `specs/ADRs/ADR-070-wasm-surface-substrate.md`.
> Goal: decide whether Astro SSR on Tractor deserves a Part C feature spec. This is a validation
> POC, not a product adapter.

## Task 1 - Validation Fixture Skeleton

- Create `validations/astro-wasi-ssr/` with package metadata, one Astro SSR route, and a minimal
  README explaining the POC boundary.
- Route: `GET /health` returns JSON with status and a static marker.
- Gate: normal Astro build path produces the expected server handler artifact.

## Task 2 - Componentization Attempt

- Use `jco componentize` / ComponentizeJS against `wasi:http/incoming-handler`.
- Keep the WIT world and generated component local to the validation directory.
- Gate: either a component is produced or the blocker is captured as structured evidence.

## Task 3 - Tractor Host Execution

- Run the component on the Tractor wasmtime host.
- Serve one real request and assert status/body.
- Gate: success evidence includes command, output, and latency notes; failure evidence includes the
  exact incompatibility layer.

## Task 4 - ADR Outcome

- If green: write a Part C feature spec for an adapter and keep the validation as evidence.
- If red: update ADR-070 with the blocker and explicitly retain Parts A/B.
- Do not let a red Part C block item 4, Marimo WASM distribution, or native-first Tractor work.

## Budget Guard

Timebox the POC. If componentization requires designing a new runtime or custom JS engine glue,
stop and record the blocker instead of turning the POC into product work.
