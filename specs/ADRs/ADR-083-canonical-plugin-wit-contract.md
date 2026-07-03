# ADR-083: Canonical Plugin WIT Contract

**Status**: Accepted
**Date**: 2026-07-03
**Deciders**: Arthur Silva, Refarm agents
**Related**: ADR-047 (Tractor Native Rust Host), ADR-059 (Tractor Rust as
Authoritative Runtime), ADR-070 (WASM Surface Substrate),
`packages/refarm-plugin-wit`, `packages/agent`, `packages/tractor`

---

## Context

The `refarm:plugin@0.1.0` WIT contract — the language-neutral boundary every
plugin crosses — had drifted into **eight files in four mutually-incompatible
shapes**, each copied locally by its consumer:

- `refarm-plugin-host.wit` (byte-identical copies in `packages/refarm-plugin-wit/wit/`
  and `packages/agent/wit/`): `integration` **with** `respond`, 6 host imports.
- `refarm-sdk.wit` (byte-identical copies in `wit/` and `packages/tractor/wit/`,
  kept in sync by a Windows-symlink workaround script): `integration` **without**
  `respond`, plus aspirational `http-handler` + `identity-provider`.
- `refarm-plugin.wit` (`templates/rust-plugin/`, `validations/simple-wasm-plugin/`):
  a single `interface plugin` (not `integration`), errors collapsed to `string`.
- `null-plugin/wit/world.wit` (test fixture): its own local copy.

**Root cause:** every consumer's `[package.metadata.component.target] path = "wit"`
pointed at a **local copy**. `packages/refarm-plugin-wit` — a WIT-only crate
created to be the canonical home — was **orphaned** (no consumer referenced it).

Because the copies drifted, a plugin built against the "SDK" shape exported a
different surface than the host's bindgen expected (host `integration` required
`respond`; the SDK omitted it), and template-scaffolded plugins could not load.
Nothing is published yet, so this could be fixed cleanly with no migration.

The maintainer's framing: *the interface is one; that not every plugin uses
everything does not mean a capability is reserved to one plugin. The agent does
what it does because of the interface, not because only it may hold that
interface.*

---

## Decision

**One canonical WIT package, one unified `integration` interface, referenced by
every consumer — never copied.**

1. **Single source of truth.** `packages/refarm-plugin-wit/wit/` is the *only*
   place `refarm:plugin@0.1.0` is defined, split for readability into
   `types.wit` / `host.wit` / `integration.wit` / `optional.wit` / `worlds.wit`
   (a WIT directory is one package namespace). Content is the existing
   host-side bodies verbatim — a file move, not a reshape — so generated Rust
   paths (`crate::refarm::plugin::*`) stay byte-stable.

2. **One `integration` interface for every plugin.** It declares all eight
   lifecycle funcs including `respond`. A plugin implements every func; the ones
   it does not use return a trivial stub (e.g. `respond -> Err(not-permitted(...))`).
   There is **no** base/optional split of `respond` into a separate interface —
   the interface is shared, the behaviour is the plugin's. The agent implements
   `respond` for real; the template and bridge plugins stub it.

3. **Consumers reference, never copy.** Each consumer's
   `[package.metadata.component.target] path` (and `wit_bindgen::generate!` /
   `wasmtime::component::bindgen!` path) points at
   `packages/refarm-plugin-wit/wit`. The local `wit/` copies are deleted.

4. **`http-handler` and `identity-provider` are preserved** (ported into
   `optional.wit`) as additive interfaces exported via composed worlds
   (`refarm-http-plugin`, `refarm-identity-plugin`). No live Rust/WASM consumer
   generates bindings for them today; they are kept so nothing is lost.

5. **Anti-drift guard.** `scripts/ci/check:wit` (repurposed from the old
   two-copy sync check) asserts the canonical package parses AND that no `.wit`
   declares `package refarm:plugin@` outside the canonical dir. The two
   Windows-workaround sync scripts are retired.

---

## Alternatives Considered

### A. Base `integration` (7 funcs) + separate `responder` interface, composed per-world
**Pros:** a plugin that does not respond implements only 7 funcs (no stub).
**Cons:** two interfaces instead of one; contradicts "the interface is one".
**Rejected** by the maintainer in favour of a single interface with a stub.

### B. Keep two plugin models (agent vs bridge), just de-duplicate the files
**Cons:** the two `integration` interfaces collided on name with incompatible
signatures; keeping both perpetuates the drift the ADR exists to end.

### C. Type the node/contract into fixed WIT records
Out of scope here (see ADR on the graph node) — the node wire type stays an open
`json-ld-node = string`.

---

## Consequences

**Positive:**
- One contract to explain; a plugin is defined by what it implements, not by a
  reserved capability.
- Drift is structurally impossible (one file) and CI-guarded.
- Templates/validations compile against the real contract for the first time.
- `refarm:plugin` WIT is now genuinely reusable: a plugin (backend, worker,
  wasm, future frontend) references the canonical package and may extend it with
  its own WIT world.

**Negative / follow-up:**
- Pre-compiled `.wasm` fixtures (`agent.wasm`, `null-plugin.wasm`) MUST be
  rebuilt when the contract changes, or tests run against a stale binary. The
  conformance suite makes this an observable red/green signal.
- Plugins that do not respond carry a one-line `respond` stub — accepted cost of
  a single interface.

---

## References

- `packages/refarm-plugin-wit/wit/` — the canonical package (this ADR).
- `scripts/ci/check-agent-wit-sync.mjs` — the anti-drift guard (`check:wit`).
- `packages/tractor/tests/conformance.rs` — cross-language load/lifecycle proof.
