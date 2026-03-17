# ADR-046: Refarm Composition Model — Blocks and Distros

**Status**: Accepted
**Date**: 2026-03-17
**Deciders**: Core Team

---

## Context

Refarm began as a product with a clear sovereign philosophy: offline-first, local-first, P2P, user
sovereignty. This philosophy is correct for the Refarm distros (`refarm.me`, `refarm.dev`,
`refarm.social`). But it was never explicitly separated from the building blocks that implement it.

The risk: a developer who needs to build a standard centralized web application reads
"Personal Operating System for Sovereign Data," sees CRDT and Nostr everywhere, and concludes that
Refarm only works for P2P sovereign apps. They walk away and rewrite from scratch — exactly what
we want to prevent.

The truth is already in the code. `TractorConfig.sync?` is optional. `StorageAdapter` is a pure
async interface with no assumption about where data lives. `IdentityAdapter` can be a session
token or a Nostr keypair equally. But this universality was never named.

---

## Decision

**Blocks are philosophy-neutral. Distros carry the philosophy.**

The Refarm monorepo is organized as two distinct layers:

### Layer 1 — Blocks (`packages/`)

Building blocks that any developer can use to build **any** type of application:
centralized, hybrid, or sovereign. Blocks are:

- **Philosophy-neutral**: No block assumes offline-first, P2P, or sovereignty
- **Composable**: Any combination of blocks is valid (e.g., Tractor + REST adapter + no sync)
- **Portable**: Each block is independently publishable to npm and usable outside Refarm
- **Governed by contracts**: `storage-contract-v1`, `sync-contract-v1`, `identity-contract-v1`

### Layer 2 — Distros (`apps/`)

Opinionated assemblies of blocks. Refarm's own distros embody the sovereign philosophy:

| Distro | Philosophy |
| --- | --- |
| `apps/me` (`refarm.me`) | Sovereign citizen hub — local-first, OPFS, offline |
| `apps/dev` (`refarm.dev`) | Developer IDE — CRDT sync, plugin marketplace |
| `apps/farmhand` | Daemon — always-on sync, local-first orchestration |

**Distros are examples, not requirements.** Third parties can build their own distros
using Refarm blocks without adopting the sovereign philosophy.

---

## Dogfood Rule

Every Refarm distro must be buildable entirely from Refarm blocks. This serves two purposes:

1. **Validation**: If our own distros can't use our blocks, the blocks are broken
2. **Demonstration**: Distros are living examples of how blocks compose

This means: if Refarm needs a centralized API adapter for a future distro, a
`@refarm.dev/storage-rest` block must exist in `packages/` before it is used in `apps/`.

---

## Layering Rules

### For `packages/` (Blocks)

1. A block MUST NOT assume the application is offline-first, local-first, or sovereign
2. A block MUST NOT import from `apps/` or from other Refarm-specific blocks (contracts only)
3. A block MUST be usable standalone — importable into a non-Refarm project
4. A block MUST have a clear single responsibility (one contract to implement)
5. Sovereign/local-first features belong in specific blocks (`sync-loro`, `storage-sqlite`),
   not baked into universal blocks (`tractor`, `storage-contract-v1`)

### For `apps/` (Distros)

1. A distro MAY be as opinionated as it needs to be
2. A distro MUST use Refarm blocks — no inline re-implementations of block functionality
3. A distro MAY combine any blocks in any order
4. Philosophy lives here, not in blocks

---

## Consequences

### Positive

- Developers building centralized apps can use `@refarm.dev/tractor` + `@refarm.dev/storage-rest`
  without touching Loro, Nostr, or OPFS
- The Refarm ecosystem grows beyond the sovereign niche
- Dogfooding ensures blocks stay general-purpose
- `sync?` being optional in `TractorConfig` is now an **intentional architectural guarantee**,
  not an accident

### Block Examples by Use Case

| Use Case | Storage Block | Sync Block | Identity Block |
| --- | --- | --- | --- |
| Centralized web app | `storage-rest` | none | session token adapter |
| Hybrid (local + cloud) | `storage-sqlite` + `storage-rest` | custom `SyncAdapter` | any |
| Sovereign local-first | `storage-sqlite` | `sync-loro` | `identity-nostr` |
| Pure offline | `storage-sqlite` | none | `identity-nostr` |

### Negative / Trade-offs

- More packages to maintain (each combination of capabilities needs its own block)
- Documentation must clearly distinguish "this is a block" from "this is a distro choice"
- The sovereign brand of `@refarm.dev` may still imply philosophy — mitigated by this ADR

---

## Related

- [ADR-001 — Monorepo Structure](ADR-001-monorepo-structure.md) (defines `packages/` vs `apps/` separation)
- [ADR-045 — Loro CRDT Adoption](ADR-045-loro-crdt-adoption.md) (example of a sovereign-specific block)
- `@refarm.dev/storage-rest` — first block explicitly created for centralized use cases
