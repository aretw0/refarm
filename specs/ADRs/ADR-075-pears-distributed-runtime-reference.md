# ADR-075: Pears as Distributed Runtime Reference

**Status**: Accepted
**Date**: 2026-06-30
**Authors**: Arthur Silva, Codex
**Related**: ADR-046 (Blocks and Distros), ADR-049 (Post-Graduation Horizon),
ADR-070 (WASM Surface Substrate), ADR-074 (Remote Workspace Control Plane),
`docs/CONVERGENCE_ROADMAP.md`, `docs/ECOSYSTEM_SUPPLY_MAP.md`

---

## Context

Pears by Holepunch is a strong external reference for the part of Refarm that wants to become a
personal, multi-surface, peer-capable software platform rather than only an app. The Pear docs
describe a platform that loads applications from peers, uses Bare as a small embeddable JavaScript
runtime, composes Hypercore/Hyperdrive/Corestore/Hyperswarm style building blocks, separates a
portable "Pear-end" from platform-specific UI hosts, and treats application distribution and
availability as swarm-native concerns.

Important observed patterns:

- **Layered runtime stack**: native foundations, a small runtime, userland modules, P2P building
  blocks, a platform layer, then apps.
- **Portable core / thin UI split**: peer logic, storage, and business rules run in a worker-like
  core; desktop, mobile, and terminal UIs talk to it over an IPC/RPC boundary.
- **Same primitives for code and data**: application bundles and application data both ride on
  append-only/replicable storage concepts.
- **Distribution by link plus availability policy**: stable application links, staged releases,
  seeding, lazy replication, and blind peers make availability an explicit operational concern.
- **Release trust ladder**: stage, provision, release lines, and multisig make publication a
  first-class platform workflow rather than an afterthought.

Refarm already has adjacent pieces: Tractor native/WASM runtime, dispatch surfaces, task/session/
effort/process contracts, stream transports, artifact/release evidence, source adapters, Loro/SQLite
sync, operator finish lanes, and the remote workspace control-plane horizon. The missing step is
to state what Pears teaches Refarm without cargo-culting its specific stack.

## Decision

Refarm will use Pears/Holepunch as a **distributed runtime reference model** for platform shape.

This is an architectural influence, not a dependency decision:

- Refarm keeps Tractor, Loro/SQLite, WIT/component boundaries, `dispatch-surface`, and the existing
  package/contract strategy as the current implementation path.
- Bare, Hypercore, Hyperdrive, Corestore, Hyperswarm, HyperDHT, and Pear runtime APIs are research
  references. They are not adopted into Refarm core without a focused proof and a second consumer
  or dogfood pressure.
- `apps/refarm`, PWA, Android, CLI, Telegram, Matrix, and future operator UIs should be treated as
  hosts/surfaces around a package-owned portable core, matching ADR-074 rather than accumulating
  control-plane logic in the app.
- Release and availability must be modeled together. A package, plugin, remote workspace node, or
  generated distribution is not "distributed" just because it can be packed; it needs identity,
  provenance, update, seed/availability, rollback, and trust evidence.

## Refarm Translation

| Pears pattern | Refarm translation | Current owner |
| --- | --- | --- |
| Pear-end separated from UI | portable control/runtime core behind thin surfaces | Tractor, runtime-agent, `dispatch-surface`, ADR-074 |
| Bare worker plus IPC seam | bounded process/task/stream/RPC seam, not raw shell | `process-handoff`, `task-contract-v1`, `stream-contract-v1` |
| Hypercore/Hyperdrive/Corestore for code/data distribution | artifact/release/source/storage manifests with provenance and retention | `artifact-contract-v1`, `release-engine`, `source:v1`, storage/sync packages |
| `pear://` link and swarm install/update | future Refarm install/distribution descriptor with stable identity and update evidence | plugin manifest, release policy, future distribution proof |
| seeding and blind peers | availability policy for nodes, artifacts, plugins, and generated distributions | not yet created; proof-gated |
| stage/provision/multisig | release trust ladder and signed promotion evidence | `release-engine`, package acceptance, policy contracts |

## Primitives To Cultivate

1. **Portable workspace node descriptor**: continue ADR-074 from proof-local fixture toward a package
   only when a second surface or consumer requires it.
2. **Host/core seam**: grow typed, auditable process/task/stream boundaries before adding new app
   affordances.
3. **Availability policy**: define how Refarm records "who keeps this artifact/app/node available"
   before claiming P2P distribution.
4. **Distribution evidence**: extend release/artifact manifests toward install/update/rollback and
   seed/availability evidence.
5. **P2P substrate research**: compare Loro/SQLite/Tractor transports with Hypercore-family ideas
   through contained validations, not by replacing sync or storage in-place.

## What To Compose Now

- Use `validations/remote-workspace-control-plane` as the local analogue of a portable core proof:
  node status, bounded read-only command, stream, cancel, and evidence.
- Let `@refarm.dev/health/environment-pressure` and `planEnvironmentWorkCeiling` represent the
  environment ceiling that every remote node must advertise before accepting work.
- Keep `dispatch-surface`, `process-handoff`, `stream-contract-v1`, `artifact-contract-v1`, and
  `release-engine` as the current composition path.
- Keep apps thin: app work should render topology, status, streams, approvals, and receipts rather
  than owning the runtime contract.

## Non-goals

- Do not rename Refarm concepts to Pear concepts.
- Do not replace Tractor with Bare.
- Do not replace Loro/SQLite with Hypercore-family storage without a focused proof.
- Do not add P2P distribution as a new broad mega-project before package/release evidence is boring.
- Do not make a package just because Pear has an equivalent primitive; create one only when the
  Refarm package-boundary triggers in ADR-072/ADR-073/ADR-074 are met.

## Consequences

### Positive

- Refarm gains a mature reference posture for "platform, not app" without derailing current work.
- The remote workspace control-plane horizon becomes more concrete: portable core, thin hosts,
  explicit availability, and release/update evidence.
- The supply map gets a stronger distribution axis beyond npm/crates.
- Future PWA/Android/Telegram/Matrix surfaces have a clearer boundary: they host and approve work;
  they do not own the portable core.

### Risks

- Pears' stack is compelling enough to invite premature rewrites. Mitigation: all adoption remains
  proof-gated and package-boundary gated.
- Refarm's Rust/WASM/Tractor direction can be diluted if "P2P platform" is interpreted as "use the
  same libraries." Mitigation: this ADR adopts the architectural pattern, not the implementation.
- Availability can become vague product language. Mitigation: require concrete seed/replica/update/
  rollback evidence before claiming distributed availability.

## References

- Pear docs home: <https://docs.pears.com/>
- Pears site: <https://pears.com/>
- The Pears stack: <https://docs.pears.com/explanation/the-pears-stack/>
- Runtime and languages: <https://docs.pears.com/explanation/runtime-and-languages/>
- Storage and distribution: <https://docs.pears.com/explanation/storage-and-distribution/>
- Release pipeline: <https://docs.pears.com/explanation/release-pipeline/>
