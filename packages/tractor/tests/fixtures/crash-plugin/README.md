# crash-plugin fixture

A DELIBERATELY misbehaving `plugin:crash-plugin` WASM component: its `on_event`
spins forever. Used to prove host RESILIENCE — under the epoch budget
(`REFARM_ON_EVENT_TIMEOUT_MS`) the runaway store is trapped and torn down
mid-event, and the respawn supervisor reinstantiates a fresh instance, so a
single bad extension does not bring the sovereign machine down. The rest of the
lifecycle (setup/metadata/respond) returns success, so the plugin still loads.

The built artifact `tests/fixtures/crash-plugin.wasm` is committed (tracked
binary) — building a WASM component is not part of a normal `cargo test` run,
and consumers SKIP with a message when it is missing.

## Rebuild

When the source (`src/lib.rs`) or the canonical WIT changes, regenerate the
committed `.wasm`:

```bash
# from packages/tractor/tests/fixtures/crash-plugin
cargo component build --release --target wasm32-wasip1
cp target/wasm32-wasip1/release/crash_plugin.wasm ../crash-plugin.wasm
```

Like `null-plugin`, this uses the `wit_bindgen::generate!` macro (bindings are
expanded in-place at compile time), so there is no separate `src/bindings.rs`
file to track — only `src/lib.rs`.
