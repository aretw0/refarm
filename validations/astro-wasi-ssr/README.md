# Astro WASI SSR POC

Validation for ADR-070 Part C. This is not a product adapter and does not move
Astro site ownership into Refarm.

Astro 7 is the target for this validation because it moves more of Astro's
tooling surface toward native Rust/WASM-shaped infrastructure: Vite 8/Rolldown,
the Rust `.astro` compiler with WASM fallback, Rust-backed Markdown/MDX, and the
`src/fetch.ts` advanced routing entrypoint. This POC only proves the first
boundary: whether a normal Astro server build can emit a fetch-shaped handler
that Refarm can later attempt to componentize.

Current scope:

- one Astro SSR endpoint: `GET /health.json`;
- one local validation adapter using Astro's normal server build path;
- one Node test that imports the generated server handler and asserts status,
  headers, and body.

Run:

```bash
pnpm -C validations/astro-wasi-ssr run build
pnpm -C validations/astro-wasi-ssr run test
pnpm -C validations/astro-wasi-ssr run componentize
```

Task 2 status: blocked at WIT resolution, before Astro handler evaluation.
`jco componentize` does not provide the `wasi:http@0.2.3` package graph
automatically, so the local world cannot yet resolve
`wasi:http/incoming-handler@0.2.3`. Evidence:
`evidence/componentize-attempt.json`.

Next POC steps remain intentionally separate: vendor the official WASI HTTP WIT
dependency graph locally or generate it from a known-good WASI HTTP component,
then rerun `componentize`. If the next layer requires a custom JS engine or
runtime design, record that blocker in ADR-070 instead of turning this
validation into product work.
