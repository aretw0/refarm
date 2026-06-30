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
pnpm run release:boundary:audit
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
pnpm --silent run release:vault-seed:handoff -- --pack --prune-extra --json --out .refarm/handoff/vault-seed/<YYYY-MM-DD>/manifest.json
pnpm --silent run release:vault-seed:handoff -- --out .refarm/handoff/vault-seed/<YYYY-MM-DD>/manifest.md
```

The local handoff uses the daily operator artifact path
`.refarm/handoff/vault-seed/<YYYY-MM-DD>/`. That directory is ephemeral; the
versioned policy and package checks remain the durable source of truth. The
handoff command materializes package tarballs sequentially before writing
`manifest.json` beside those `.tgz` files and validating the manifest, SHA-256
inventory, tarball freshness, and publishable build-output freshness. The JSON
manifest declares `schemaVersion: 1` and
`source: "vault-seed-ready-handoff"` so downstream checks can treat it as an
explicit handoff contract. `manifest.md` is the operator-readable companion, but
the official consumer checkout should collect the `.tgz` files listed in
`manifest.json` and use that manifest as the integrity and assimilation
checklist. The `consumerInstall` block provides ready-to-copy `file:` specs and
`pnpmOverrides` for a consumer-local `vendor/` directory while leaving the
choice of direct dependencies downstream-owned. When cleanup is requested,
`prunedExtra` records the unexpected generated tarballs removed before
validation.
The `distributionEvidence` block records the local distribution state for the
packet: stable/current handoff refs, verified local-copy count, tarball SHA-256
inventory, update source, rollback strategy, and explicit boundaries that this
is not a public install contract or P2P substrate.
When a package rename or selection change intentionally leaves old generated
tarballs in that ephemeral directory, rerun the handoff with `--prune-extra` to
delete only unexpected `.tgz` files before manifest validation.
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
| `@refarm.dev/health` | release-profiled; not selected | generic diagnostics, `environment-pressure`, and work-ceiling SDK primitives are ready, but promotion waits for a consumer-pulled proof or default-candidate decision |
| `@refarm.dev/source-contract-v1` | release-profiled; not selected | source capability contract is implemented and checked; publication waits for an executable dogfood, `vault-seed`, or `agents-lab` consumer proof rather than mere strategic intent |
| `@refarm.dev/source-git` | release-profiled; not selected | clean cached checkout adapter is implemented and dogfooded; handoff promotion waits for a selected consumer path that needs package consumption |
| `@refarm.dev/source-local` | release-profiled; not selected | live working-tree reads are useful for Refarm dogfood and expected downstream assimilation, but handoff promotion waits for a proof that dirty/untracked state is required |
| `@refarm.dev/source-dispatch` | not created | dispatch adapter activates when Refarm, `vault-seed`, or `agents-lab` needs `source:v1` through `dispatch-surface` with an executable proof |
| `@refarm.dev/skill-contract-v1` | implemented; not selected | native `skill:v1` manifest/plan/request/decision/receipt/surface/preflight helpers are checked, plugin-manifest validates `pi/skill` package surfaces, the plan-only Refarm git-workflow smoke records a host policy decision, the source-status smoke records one `source:v1` engine call through `@refarm.dev/source-local`, the `agents-lab` git-workflow wrapper smoke records external source evidence without installing upstream skill text, and the DGK `vault-search` wrapper smoke records external `vault-seed` source evidence plus a package-declared `pi/skill` surface and blocked activation preflight without executing `dgk` or Obsidian CLI; publication now waits for runtime-host and install-policy proof rather than a missing DGK wrapper fixture |
| `@refarm.dev/source-web` or equivalent | not created | authenticated web capture is a T3 requirements-vault pressure point; package design must prove session evidence, pacing, cache identity, offline replay, and redaction while leaving target discovery/login/selectors downstream |
| `@refarm.dev/enrichment-contract-v1` | not created | deterministic record/note enrichment is the smallest new T3 contract; promotion waits for a neutral fixture, conformance/validator output, and a downstream proof with private providers kept outside Refarm |
| knowledge/content manifest package | not created | requirement-like records now provide second-consumer pressure for the held knowledge/content envelope, but package extraction waits for the requirements supply activation packet to settle source and enrichment evidence shapes |
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
   `pnpm run release:boundary:audit` emits the machine-readable release boundary
   audit for the current `vault-seed-ready` handoff lane; the
   `release:vault-seed:handoff` manifest embeds the same summary as
   `releaseBoundaryAudit` and blocks the handoff when that audit fails.

Current commands:

```bash
refarm release preflight --selection default --json
refarm release preflight --selection vault-seed-ready --json
pnpm run release:readiness
pnpm run release:readiness:test
pnpm run release:boundary:audit
pnpm run release:vault-seed:check
pnpm --silent run release:vault-seed:handoff -- --pack --json
pnpm --silent run release:vault-seed:handoff -- --pack --prune-extra --json
pnpm --silent run release:vault-seed:handoff -- --pack --prune-extra --json --out .refarm/handoff/vault-seed/<YYYY-MM-DD>/manifest.json
pnpm --silent run release:vault-seed:handoff -- --out .refarm/handoff/vault-seed/<YYYY-MM-DD>/manifest.md
```

---

## Repository State

- Current version: `v0.0.1-dev`
- Public scope: `@refarm.dev`
- Default release-policy selection: `kernel-candidates`
- Consumer-pulled selection: `vault-seed-ready`
- Publication posture: held until daily-driver gate or explicit human override
