# Publishing Rust Crates — Roadmap

> This document describes the path from **monorepo-local Rust crates** to
> **published crates on [crates.io](https://crates.io)**.

## Crate Inventory

| Crate | Path | Publishable | Status |
|---|---|---|---|
| `refarm-tractor` | `packages/tractor` | ✅ | Ready |
| `refarm-hello-world-plugin` | `validations/wasm-plugin/hello-world` | ✅ | Ready |
| `refarm-simple-wasm-plugin` | `validations/simple-wasm-plugin` | ❌ | `publish = false` |
| `rust-plugin-template` | `templates/rust-plugin` | ❌ | `publish = false` |

## Pre-requisites

1. **crates.io account/team** — owner with publish permission for the crate
2. **CI secret** — `CARGO_REGISTRY_TOKEN` available in GitHub Actions
3. **CI release gate enabled** — `RELEASE_AUTOMATION=true`
4. **Optional owner lock** — `RELEASE_OWNER=<owner>` to restrict publishes to one repo owner

## Publication Checklist

When release automation is enabled, follow these steps per crate:

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

The release automation is handled by [.github/workflows/publish-crates.yml](../.github/workflows/publish-crates.yml) and follows the same security gates as npm:

```yaml
if: vars.RELEASE_AUTOMATION == 'true' && (vars.RELEASE_OWNER == '' || github.repository_owner == vars.RELEASE_OWNER)
```

```yaml
jobs:
  publish-crates:
    if: vars.RELEASE_AUTOMATION == 'true' && (vars.RELEASE_OWNER == '' || github.repository_owner == vars.RELEASE_OWNER)
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
