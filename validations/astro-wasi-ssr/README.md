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
```

Next POC steps remain intentionally separate: componentize the generated handler
against `wasi:http/incoming-handler`, then attempt execution through the Tractor
wasmtime host. If either step requires a custom JS engine or runtime design,
record the blocker in ADR-070 instead of turning this validation into product
work.
