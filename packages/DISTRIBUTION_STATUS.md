# Capability Contracts - Distribution Inventory

**Status:** candidate inventory validated; public publication is held.

Refarm is not publishing `v0.1.0` just because the first contracts are ready.
The current policy is: keep publication on hold until the daily-driver gate
passes or a human explicitly overrides it. Consumer-pulled `vault-seed` blocks
may still move through a local candidate channel when that prevents downstream
reimplementation.

Source of truth:

- Release policy: [`refarm.config.json`](../refarm.config.json)
- Release gate: [`docs/v0.1.0-release-gate.md`](../docs/v0.1.0-release-gate.md)
- Release engine: [`packages/release-engine`](./release-engine)
- Factory readiness: [`docs/CONVERGENCE_FACTORY_READINESS.md`](../docs/CONVERGENCE_FACTORY_READINESS.md)

---

## Current Release-Policy Selections

### `kernel-candidates` (default selection)

These packages are the first release candidates for daily-driver planning. They
are not an immediate publish list while the daily-driver hold is active.

- `@refarm.dev/storage-contract-v1`
- `@refarm.dev/sync-contract-v1`
- `@refarm.dev/identity-contract-v1`
- `@refarm.dev/channel-policy-v1`

Validation:

```bash
pnpm run release:readiness
```

### `vault-seed-ready` (consumer-pulled candidate lane)

These packages are allowed into the local handoff lane because `vault-seed`
would otherwise keep rebuilding reusable Refarm machinery. This is a candidate
channel, not a public npm publication promise.

- `@refarm.dev/artifact-contract-v1`
- `@refarm.dev/channel-policy-v1`
- `@refarm.dev/effort-contract-v1`
- `@refarm.dev/process-handoff`
- `@refarm.dev/release-engine`
- `@refarm.dev/ds`
- `@refarm.dev/heartwood`
- `@refarm.dev/dispatch-surface`
- `@refarm.dev/silo`

Validation:

```bash
pnpm --silent run release:vault-seed:check -- --plan --json
pnpm --silent run release:vault-seed:handoff -- --pack --json
```

The local handoff uses the daily operator artifact path
`.refarm/handoff/vault-seed/<YYYY-MM-DD>/`. That directory is ephemeral; the
versioned policy and package checks remain the durable source of truth. The
handoff command materializes package tarballs sequentially before validating the
manifest, SHA-256 inventory, tarball freshness, and publishable build-output
freshness. The JSON manifest declares `schemaVersion: 1` and
`source: "vault-seed-ready-handoff"` so downstream checks can treat it as an
explicit handoff contract.
The `vault-seed-ready` release-policy selection also carries an
`audienceBoundary` contract: consumer `vault-seed`, naming
`product-neutral-sdk`, and vault-specific CLI labels, copy, notebooks, routes,
and UX remaining downstream-owned.
Each package entry also carries `consumerPull` metadata when the selected package
has a known `vault-seed` adoption target. That metadata names the downstream
use, a stable `proofId`, the expected `vault-seed` proof target, and the
ownership boundary that must stay product-local. The same proof targets are
flattened into `consumerProofs` so downstream checks can validate the adoption
work without scraping the tarball table or matching prose.

---

## Historical Contract Inventory

The original three foundational contracts remain low-risk interface packages:

| Package | Purpose | Conformance | Stability |
| --- | --- | --- | --- |
| `@refarm.dev/storage-contract-v1` | Storage backend capability contract | 6 validations | versioned contract |
| `@refarm.dev/sync-contract-v1` | CRDT delta format for interoperable sync | 4 validations | versioned contract |
| `@refarm.dev/identity-contract-v1` | Identity/signing capability contract | 4 validations | versioned contract |

They are still useful release candidates, but the current kernel selection has
expanded to include `@refarm.dev/channel-policy-v1`, and publication remains
gated by the daily-driver policy.

---

## Deliberately Held Surfaces

Some packages are useful but must not be promoted just because neighboring leaf
packages are ready:

| Surface | Current status | Reason |
| --- | --- | --- |
| `@refarm.dev/health` | release-profiled; not selected | generic diagnostics and `environment-pressure` SDK are ready as primitives, but promotion waits for a consumer-pulled proof or default-candidate decision |
| `@refarm.dev/source-local` | implemented; not selected | live working-tree reads are useful for the librarian, but consumer handoff waits for a proof that dirty/untracked state is required |
| `@refarm.dev/homestead` | held out of `vault-seed-ready` | full SDK closure still pulls Tractor/storage/sync/plugin dependencies; DS-only HTML helpers ship through `@refarm.dev/ds/html` |
| `@refarm.dev/homestead-ssr` | removed pre-publication | `@refarm.dev/ds/html` is the canonical DS-owned helper surface |
| `@refarm.dev/cli` | held out of `vault-seed-ready` | `@refarm.dev/process-handoff` is the leaf package needed by consumers |
| `@refarm.dev/plugin-manifest` | deferred | Pi/WASM/UI plugin boundary still needs reproducible multi-layer proof |
| `refarm-plugin-wit` | internal canonical WIT crate | `publish = false`; the supply surface is `refarm:plugin@0.1.0` WIT, not crates.io/npm yet |
| `refarm:agent-tools@0.1.0` | internal WIT component boundary | guarded by build-free `validate-packages` preflight before any component packaging promotion |
| Tractor/runtime reference implementation | daily-driver hold | must be reliable for real operator work before public release positioning |

---

## Publication Rules

Do not run public publish steps while the daily-driver hold is active unless the
human operator explicitly asks for that override.

Before any publication or handoff:

1. Confirm the intended selection in `refarm.config.json`.
2. Run the scoped release check for that selection.
3. Preserve package-local dry-run evidence.
4. Keep consumer-specific UX and vocabulary downstream-owned.
5. Prefer codemods or manifest-driven generation for mechanical consumer moves.
6. Audit exported SDK names: use product-neutral domain names for reusable
   primitives, and reserve `Refarm` prefixes for product identity surfaces.

Current commands:

```bash
refarm release preflight --selection default --json
refarm release preflight --selection vault-seed-ready --json
pnpm run release:readiness
pnpm run release:readiness:test
pnpm run release:vault-seed:check
pnpm --silent run release:vault-seed:handoff -- --pack --json
```

---

## Repository State

- Current version: `v0.0.1-dev`
- Public scope: `@refarm.dev`
- Default release-policy selection: `kernel-candidates`
- Consumer-pulled selection: `vault-seed-ready`
- Publication posture: held until daily-driver gate or explicit human override
