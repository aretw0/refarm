# Publishing Rust Crates — Roadmap

> This document describes the path from **monorepo-local Rust crates** to
> **published crates on [crates.io](https://crates.io)**.

## Crate Inventory

| Crate | Path | Publishable | Status |
|---|---|---|---|
| `refarm-tractor` | `packages/tractor` | ✅ | Ready — awaiting org migration |
| `refarm-hello-world-plugin` | `validations/wasm-plugin/hello-world` | ✅ | Ready — awaiting org migration |
| `refarm-simple-wasm-plugin` | `validations/simple-wasm-plugin` | ❌ | `publish = false` |
| `rust-plugin-template` | `templates/rust-plugin` | ❌ | `publish = false` |

## Pre-requisites

1. **GitHub org migration** — repo must be under `refarm-dev`
2. **crates.io account** — register `refarm-dev` as owner / team
3. **CI secret** — `CARGO_REGISTRY_TOKEN` available in GitHub Actions

## Publication Checklist

When the org is ready, follow these steps per crate:

```bash
# 1. Dry-run — validates metadata, README, license (per LICENSING_POLICY.md)
cargo publish --dry-run -p refarm-tractor

# 2. Verify the package contents
cargo package --list -p refarm-tractor

# 3. Publish (requires CARGO_REGISTRY_TOKEN)
cargo publish -p refarm-tractor
```

## Publication Order

```
refarm-tractor          # standalone, no inter-crate deps
refarm-hello-world-plugin  # standalone WASM plugin
```

## CI Integration

The release automation is handled by [.github/workflows/publish-crates.yml](file:///.github/workflows/publish-crates.yml) and follows the same security gates as npm:

```yaml
if: github.repository_owner == 'refarm-dev' && vars.RELEASE_AUTOMATION == 'true'
```

```yaml
jobs:
  publish-crates:
    if: github.repository_owner == 'refarm-dev' && vars.RELEASE_AUTOMATION == 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo publish -p refarm-tractor
        env:
          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

## npm Isolation

Rust packages are protected from accidental npm publish via:

1. `"private": true` in every `package.json` → blocks `npm publish`
2. Changeset `ignore` list in `.changeset/config.json` → blocks versioning PRs
3. `publish = false` in `Cargo.toml` for non-publishable crates
