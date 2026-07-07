# @refarm.dev/source-provider-ref

A **`source:v1` provider that arrives as a WASM extension** — the proof that a provider
can be *loaded*, not *imported*. Where `@refarm.dev/source-web` is a TypeScript object an
app injects, this is a `.wasm` component the host loads and calls. This is "import less,
extend more" in its purest form.

## How it works

The plugin implements the **canonical `integration` interface** — the refarm doctrine is
*one interface; a plugin is what it implements*, not what interface is reserved to it. So
there is no new "source-provider" WIT interface. Instead, the provider does its work in
`respond`, the **synchronous request/response channel** of `integration`:

```
host  ──►  respond({ "method": "discover" })  ──►  guest
host  ◄──  '{"entries":[...]}'  (JSON string)  ◄──  guest
```

The host calls `respond` and reads the JSON reply directly — **no event dispatch, no
`dispatch-result` node, no graph round-trip**. `src/plugin.js` routes `respond` by
`method`:

- `discover` → the source catalog (`{ entries: [{ ref, label, kind }] }`)
- `status` → whether a ref is known/materialized
- `capability` → `{ capability: "source:v1", ... }`

The manifest (`dist/plugin.json`, generated) declares `provides: ["source:v1"]` and
`subscribes: []` — it serves via `respond`, not an event.

## The jco error convention (a footgun worth knowing)

`jco componentize` lowers the WIT `respond: func(...) -> result<string, plugin-error>` to
the **JavaScript exception convention**:

- **Success:** `return "<the string>"` — return the value directly.
- **Error:** `throw { payload: { tag: "...", val: "..." } }` — throw a tagged variant.

Returning a `{ tag: "ok", val: ... }` object (the Rust host-side shape) **traps** the
component. This provider is the first plugin to actually return `ok` from `respond`
(vault/quality stub it), so the shape had never been exercised before.

## Build + prove

```bash
pnpm --filter @refarm.dev/source-provider-ref build:plugin   # TS → jco → source_provider.wasm

# End-to-end proof: the real host loads the .wasm and calls respond:
cargo test --test source_provider_harness -- --ignored --test-threads=1
```

The harness (`packages/tractor/tests/source_provider_harness.rs`) loads the real component
and asserts `handle.call_respond({method:"discover"})` returns the catalog — the
Rust↔WASM synchronous provider seam, closed end to end.
