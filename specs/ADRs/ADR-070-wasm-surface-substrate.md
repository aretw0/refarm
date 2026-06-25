# ADR-070: WASM Surface Substrate, Ecosystem Dependency Depth, and Tractor Distribution

**Status**: Proposed (Part C is POC-gated)
**Date**: 2026-06-25
**Authors**: Arthur Silva
**Related**: ADR-044 (WASM plugin loading, browser), ADR-049 (dual-runtime), `docs/CONVERGENCE_ROADMAP.md` (item 5), `docs/ECOSYSTEM_SUPPLY_MAP.md`, `docs/VAULT_SEED_CONVERGENCE.md`

---

## Context

The convergence intuition — "the lab, the site, and Refarm are all going Rust/WASM, so they
should converge" — conflates two axes. Item 5 separates them, then asks how deeply Refarm should
lean on the ecosystem.

- **Build-time toolchain in Rust.** Astro 7 (22 Jun 2026) runs Vite 8 + **Rolldown** (a Rust
  bundler replacing esbuild/Go and Rollup), a `.astro` compiler rewritten in Rust, and a Rust
  MD/MDX pipeline. Builds are 15–61% faster. **Output is still static HTML/JS.**
- **Toolchain distribution.** Astro's own words: *"Moving to Rust allowed us to ship native
  binaries for supported platforms, with a WASM fallback for environments that need it."* The
  "WASM" in Astro is the **tool** shipped as native-binary-first + WASM-fallback (the standard
  Rust-CLI pattern: esbuild, SWC, Biome, Rolldown all do this) — **not** the site or SSR running
  as WASM.
- **Runtime distribution as WASM.** Marimo exports notebooks as WASM (Pyodide runs Python
  in-browser). Refarm's Tractor is a WASM Component Model runtime (wasmtime; `jco`). These two are
  **peers** — runtimes that execute a computed surface as WASM.

Owner direction (2026-06-25), in two clarifications:

1. The WASM interest is the **distribution discipline** (native-first + WASM-fallback) and
   leaning on the ecosystem **at the right layer** — *not* the speculative "Astro SSR on Tractor."
2. **Tractor's Rust must not be diluted.** The native binary is the strength (ADR-049: ~27MB, IoT,
   edge, air-gapped). The lesson is native-first with a WASM fallback, which centers the Rust.

## Decision

### Part A — WASM-surface contract + ecosystem dependency-depth policy (committed)

**A1. `wasm-surface:v1` distribution contract.** A contract for packaging, loading, and embedding a
computed surface as WASM, building on ADR-044. **Producers:** Marimo-WASM (Pyodide export) and
Tractor (Component Model plugin). **Consumers (embedders):** the Astro site, the lab, the admin.
Refarm provides the contract + loader, not the apps.

**A2. Dependency-depth policy — how much Astro do we actually need.** Decide per surface between
using the Astro framework, using only what Astro uses (its substrate), or neither:

| Surface | Use Astro framework? | Use Astro's substrate (Vite 8 / Rolldown / Oxc)? | Rationale |
|---|---|---|---|
| Public vault site (content, nav, graph, timeline) | **Yes** — and embed WASM surfaces | via Astro | content sites are Astro's sweet spot; consumer-owned per `VAULT_SEED_CONVERGENCE` |
| `homestead` bundled SDK / studio-host | No | **Yes — directly** | Refarm owns its shell; it needs the bundler, not the framework's opinions |
| `dgk serve` admin (build-free) | No | No | `node:http` + the `homestead/ssr` string tier (item 4b) |
| Marimo lab | No — embedded into the site | No | Pyodide WASM producer, consumed via A1 |

Principle: **lean on the ecosystem at the layer that earns its keep.** Adopt the framework where
it pays (the content site); adopt only its Rust substrate where the framework is overkill (Refarm's
own shells); adopt neither where a surface is build-free.

### Part B — Tractor distribution: native-first + WASM-fallback (committed; refines ADR-049)

Adopt the ecosystem's Rust-artifact distribution discipline for Tractor: **ship the native binary
first, with a WASM build as the fallback** for environments that cannot run native (browser,
locked-down CI, WebContainers, unusual arch). This preserves and centers Tractor's Rust rather than
diluting it.

This **refines ADR-049**, which currently frames `tractor-ts` (the TS/WASM-adjacent runtime) as the
primary recommendation and the native `tractor` binary as additive. The Astro/ecosystem lesson
inverts the emphasis: **native-first, WASM-fallback.** Reconcile the wording in a follow-up to
ADR-049; keep both runtimes (the dual-runtime decision stands), but state the distribution default
as native-first.

### Part C — Astro SSR on Tractor (speculative appendix, POC-gated)

Running Astro SSR as a `wasi:http` component on Tractor (via a custom Astro adapter + `jco
componentize` / ComponentizeJS, on SpiderMonkey/StarlingMonkey) remains an **explicitly speculative**
exploration — not the central direction. It is unblocked by Parts A and B and pursued only if the
POC below clears. If it never does, nothing in A or B is affected.

## POC — the gate for Part C only

1. One Astro SSR route (`GET /health` → JSON) built with a custom adapter emitting a JS handler.
2. `jco componentize` it against the `wasi:http/incoming-handler` WIT world.
3. Run the component on Tractor's wasmtime host; serve a real request; assert body + status.

Success: serves correctly from Tractor; cold-start + per-request latency within a budget set when
the POC lands (ADR-044's <100ms transpile is the reference order). Evidence:
`validations/astro-wasi-ssr/`. Green → Part C spec; red → drop Part C, record the blocker.

## Consequences

### Positive
- One substrate (A1); Marimo and Tractor are interchangeable WASM producers.
- A2 stops Refarm from over-adopting Astro: the framework only where it earns its keep, its Rust
  substrate elsewhere — less lock-in, faster builds via Rolldown where it matters.
- B preserves Tractor's Rust as the primary artifact while gaining the ecosystem's fallback reach.

### Risks
- Part C only: no existing Astro WASI adapter; SpiderMonkey-in-WASM cold-start/bundle size; WASI P3
  still landing. Contained by POC-first.
- B requires an ADR-049 wording reconciliation (native-first vs ts-first) — a doc change, not a code
  change.

### Boundary
- Refarm provides the substrate, the contract, the dependency-depth policy, and (if Part C lands)
  the adapter — **not** the Astro site or the Marimo notebooks.

## References

- ADR-044, ADR-049
- Astro 7 (22 Jun 2026), incl. the native-binary + WASM-fallback toolchain note: <https://astro.build/blog/astro-7/>
- ComponentizeJS: <https://github.com/bytecodealliance/ComponentizeJS> · jco: <https://bytecodealliance.github.io/jco/introduction.html>
- Marimo WASM/Pyodide export (the lab's current distribution)
