# @refarm.dev/quality-checker-ref

The **reference `quality:v1` checker** — a pure-compute WASM component that proves
the sovereign checker boundary (`world quality-checker`, package
`refarm:quality@0.1.0`, defined in
[`../quality-contract-v1/wit/quality.wit`](../quality-contract-v1/wit/quality.wit))
end to end.

It is the smallest real checker: a `text` matcher where a rule's `check` is
`{"type":"contains","value":"…"}` and a finding fires when the subject text
includes that substring. Matcher-is-data — richer matchers (regex, DOM asserts)
ship as checker code + rule data, never a contract change.

## Why it matters — the sandbox is demonstrated, not just declared

The Rust crate targets `world quality-checker`, which **imports nothing** from the
host. The host loader (`src/index.ts`, `createReferenceChecker`) instantiates the
transpiled component with **deny-all** wasi imports: no environment, no arguments,
**no preopened filesystem**, and every fs/io op traps. `check()` still returns
findings — proving the checker is pure compute that never needs the filesystem,
and that if it *tried* to reach fs or the network it could not, because the host
provides no capability to try. **The host enforces the boundary** by choosing what
to provide — here, nothing but the subject. That is the "even an untrusted checker
cannot exfiltrate" claim, run for real (`src/checker.test.ts`).

This loader is the reusable analog a real plugin host (a skill quality gate, etc.)
will use to run ANY `quality-checker` component the same sandboxed way.

## Build + test

The component (`pkg/`) is generated and gitignored; build it before the tests:

```sh
pnpm build:component   # cargo component build (wasm32-wasip1, release) + jco transpile
pnpm build             # tsc — the host loader (src/index.ts)
pnpm test              # vitest — real WASM dispatch + the sandbox proof
```

`build:component` transpiles with `--no-wasi-shim --instantiation async` so the
loader — not jco — supplies the (denied) imports. The test suite skips when `pkg/`
is absent, so a repo-wide run without the heavy component build stays green.
