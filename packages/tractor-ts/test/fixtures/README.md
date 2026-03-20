# Test Fixtures

These fixtures are used for integration testing real WASM instantiation in environments where direct `jco transpile` or complex URL schemes might be problematic (like standard Vitest runners).

## Heartwood Fixture

To regenerate the Heartwood fixture:

```bash
# From monorepo root
mkdir -p packages/tractor/test/fixtures/heartwood-transpiled
npx jco transpile packages/heartwood/target/wasm32-wasip1/release/refarm_heartwood.wasm \
  -o packages/tractor/test/fixtures/heartwood-transpiled/ \
  --name heartwood \
  --instantiation
```
