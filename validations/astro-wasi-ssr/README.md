# Astro WASI SSR POC

Validation for ADR-070 Part C. This is not a product adapter and does not move
Astro site ownership into Refarm.

Publication boundary: this workspace is intentionally private validation
evidence. Do not publish `@refarm.dev/astro-wasi-ssr-poc`, do not add it to
`releasePolicy`, and do not graduate it in place. If Part C becomes viable, open
a new package under `packages/` with a product-neutral name, contract, docs,
consumer proof, and explicit release-policy selection.

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

Task 2 status: blocked at Astro server bundle evaluation, after WIT resolution.
The fixture now vendors the minimal official WASI v0.2.3 WIT graph needed by
`wasi:http/incoming-handler@0.2.3`, so local WIT resolution is green. The
current blocker is the generated Astro server bundle's Node surface:
ComponentizeJS starts evaluating `dist/server/index.mjs` and fails on
`node:module`. Static inspection also shows `process`, `Buffer`, and `sharp`.
The package script is bounded by `timeout 45s` so this validation cannot pin
the development container if ComponentizeJS/Wizer behavior drifts. Evidence:
`evidence/componentize-attempt.json`.

Decision: Part C is red for now. Do not build a custom Astro WASI adapter or
bundle profile from this POC alone. Revisit only if a second consumer or
upstream Astro WASI bundle profile changes the cost model.
