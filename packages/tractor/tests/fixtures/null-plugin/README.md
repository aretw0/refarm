# null-plugin fixture

A minimal `refarm:null-plugin` WASM component whose lifecycle functions all
return success immediately. Used by tractor integration tests
(`plugin_shutdown`, the component-cache dedup test, the instantiation bench, and
`main_tests`) as a real, trivially-loadable component.

The built artifact `tests/fixtures/null-plugin.wasm` is committed (tracked
binary) because the tests need it present and building a WASM component is not
part of a normal `cargo test` run. The tests SKIP with a message if it is
missing, so a stale or absent fixture degrades to a no-op rather than a failure.

## Rebuild

When the source (`src/lib.rs`) or the canonical WIT changes, regenerate the
committed `.wasm`:

```bash
# from packages/tractor/tests/fixtures/null-plugin
cargo component build --release --target wasm32-wasip1
cp target/wasm32-wasip1/release/null_plugin.wasm ../null-plugin.wasm
```

The committed `src/bindings.rs` is `wit-bindgen`-generated (DO NOT EDIT); it
regenerates on build. Keep the `wit-bindgen` dependency in `Cargo.toml` aligned
with what the build actually produces so the fixture doesn't silently drift from
its source.
