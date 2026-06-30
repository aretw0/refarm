# Refarm Package Registry

This document catalogues the modular primitives and engines of the Refarm monorepo.

## 📦 Core Engines

| Package | Purpose | Maturity | Status |
|---|---|---|---|
| [`@refarm.dev/tractor`](./tractor) | The Sovereign Microkernel & Plugin Host | 🟡 Stable-ish | Internal |
| [`@refarm.dev/windmill`](./windmill) | Automation Engine & Infrastructure | 🟠 Alpha | Internal |
| [`@refarm.dev/health`](./health) | Stratified Health & Policy Auditor | 🟢 Production | Release-profiled; held |

## 🛡 Capability Contracts (v1)
These packages define foundational interoperability layers between Refarm and
its plugins. They are release-policy candidates, not an automatic publish list:
publication remains held by the daily-driver gate or explicit human override.

| Package | Tests | Status | Publishing |
|---|---|---|---|
| [`@refarm.dev/storage-contract-v1`](./storage-contract-v1) | ✅ Conformance | 🟢 Candidate | `kernel-candidates`; held |
| [`@refarm.dev/sync-contract-v1`](./sync-contract-v1) | ✅ Conformance | 🟢 Candidate | `kernel-candidates`; held |
| [`@refarm.dev/identity-contract-v1`](./identity-contract-v1) | ✅ Conformance | 🟢 Candidate | `kernel-candidates`; held |
| [`@refarm.dev/channel-policy-v1`](./channel-policy-v1) | ✅ Fixture Validation | 🟡 Candidate | `kernel-candidates` + `vault-seed-ready`; held |
| [`@refarm.dev/skill-contract-v1`](./skill-contract-v1) | ✅ Manifest/Surface Validation | 🟡 Proof-gated | held until engine dogfood smoke |

## 📚 Librarian Source Primitives

These packages provide the `source:v1` librarian boundary. They are
release-profiled and checked, but not selected for `vault-seed-ready` until a
consumer-pulled proof needs source materialization directly. The expected
consumers are real: Refarm dogfood in its own apps/runtime, the official
`vault-seed` checkout, and `agents-lab` as it moves toward Refarm as engine.
The current hold means the proof is not yet a selected handoff/publication
contract. `source-dispatch` is intentionally absent until one of those paths
needs `source:v1` through `dispatch-surface` with an executable proof.

| Package | Purpose | Publishing |
|---|---|---|
| [`@refarm.dev/source-contract-v1`](./source-contract-v1) | Versioned `source:v1` capability contract and conformance suite | release-profiled; held |
| [`@refarm.dev/source-git`](./source-git) | Clean cached git checkout provider for remote repositories | release-profiled; held |
| [`@refarm.dev/source-local`](./source-local) | Live local working-tree provider with dirty/untracked status | release-profiled; held |

## 🌿 Native Skill Surface Contract

`@refarm.dev/skill-contract-v1` is the schema/conformance helper for native
Refarm skill surfaces. It parses `SKILL.md`-style content into
`SkillManifestV1`, records source hashes, requires explicit capabilities, and
defaults to plan-only, declared-capability tool access. It also builds
host-policy-checkable invocation plans, requests, pre-runtime decisions, and
`pi/skill` surface declarations for package manifest handoff from a validated
manifest plus a relative package asset path.

It is deliberately not a second plugin system. Packages and plugin manifests
remain the distribution/trust boundary; skills are declared as surfaces or
assets inside that bundle and are consumed by runtime hosts only after policy
and adapter proof.

## 🌱 Consumer-Pulled Candidate Lane

The `vault-seed-ready` selection is a pre-publication handoff lane for packages
that `vault-seed` can consume as local tarballs before the full daily-driver
release. It is not an automatic npm publication promise: the lane remains
manual-approval gated, product-neutral, and downstream-owned for vault-specific
CLI labels, copy, notebooks, routes, and UX.

| Package | Purpose | Publishing |
|---|---|---|
| [`@refarm.dev/artifact-contract-v1`](./artifact-contract-v1) | Artifact/provenance manifests for Lab datasets, outbox manifests, and notebook snapshots | `vault-seed-ready`; held |
| [`@refarm.dev/channel-policy-v1`](./channel-policy-v1) | Channel delivery evidence, rate limits, dry-run reports, and review gates | `kernel-candidates` + `vault-seed-ready`; held |
| [`@refarm.dev/effort-contract-v1`](./effort-contract-v1) | Effort/task contract dependency for dispatch evidence | `vault-seed-ready`; held |
| [`@refarm.dev/process-handoff`](./process-handoff) | Build-free tokenized process specs and runner adapters | `vault-seed-ready`; held |
| [`@refarm.dev/release-engine`](./release-engine) | Package acceptance and release-policy summaries | `vault-seed-ready`; held |
| [`@refarm.dev/ds`](./ds) | Design tokens, theme CSS, and build-free HTML helpers consumed by vault admin/Lab UI | `vault-seed-ready`; held |
| [`@refarm.dev/heartwood`](./heartwood) | Cryptographic core dependency for Silo | `vault-seed-ready`; held |
| [`@refarm.dev/dispatch-surface`](./dispatch-surface) | Product-neutral dispatch surface contracts | `vault-seed-ready`; held |
| [`@refarm.dev/silo`](./silo) | Namespaced secret collection and storage | `vault-seed-ready`; held |

## 🔖 Plugin Metadata
This layer waits for the Pi and multi-layer plugin architecture proofs before entering the release lane.

| Package | Tests | Status | Publishing |
|---|---|---|---|
| [`@refarm.dev/plugin-manifest`](./plugin-manifest) | ✅ Validation | 🟡 Deferred | v0.2.0+ candidate |

## 🔌 Storage & Identity Adapters

| Package | Type | Backend | Maturity |
|---|---|---|---|
| [`@refarm.dev/storage-sqlite`](./storage-sqlite) | Storage | OPFS/SQLite | 🟡 Beta |
| [`@refarm.dev/storage-memory`](./storage-memory) | Storage | In-Memory | 🟢 Stable |
| [`@refarm.me/identity-nostr`](./identity-nostr) | Identity | Nostr/Relays | 🟠 Alpha (Experimental) |
| [`@refarm.dev/sync-crdt`](./sync-crdt) | Sync | Automerge-like | 🟠 Alpha |

## 🏗 Sub-systems & Utilities

- **[`@refarm.dev/silo`](./silo)**: Context & Secret Provisioning.
- **[`@refarm.dev/fence`](./fence)**: Scope & Boundary Auditing.
- **[`@refarm.dev/thresher`](./thresher)**: Data Ingestion & Transformation.
- **[`@refarm.dev/heartwood`](./heartwood)**: Cryptographic Core (WASM).
- **[`@refarm.dev/process-handoff`](./process-handoff)**: Build-free tokenized
  process launch helpers and provenance-ready runner adapters.
- **[`@refarm.dev/cli`](./cli)**: Shared CLI primitives, process adapters, JSON
  envelopes, and compatibility Refarm contracts. The executable Refarm app lives
  in `apps/refarm`.

---

> "We cultivate the code as we cultivate the soil: with patience, honesty, and respect for the cycle."
