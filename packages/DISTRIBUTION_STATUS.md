# Capability Contracts — Distribution Status

**Status:** READY FOR v0.1.0 ALPHA DISTRIBUTION (3 Contracts)

✅ 3 foundational contracts complete and tested.
✅ Repository configured for publication to @aretw0 scope (personal profile).
✅ CI/CD pipeline ready (Gate 1 completion pending in GitHub repo settings).

See Also: [REFARM_PERSONAL_DAILY_DRIVER.md](../docs/REFARM_PERSONAL_DAILY_DRIVER.md) — Publishing strategy and why plugin-manifest is deferred to v0.2.0.

---

## What's Being Published in v0.1.0

### 3 Foundational Capability Contracts (Immutable Interfaces)

These packages define **what it means to be Refarm-compatible**. They are low-risk, high-value publications because they are *interfaces*, not *implementations*.

#### 1. **@aretw0/storage-contract-v1** (0.1.0)
   - **Purpose**: Capability contract for any Refarm-compatible storage backend
   - **Conformance**: 6 validations
   - **Stability**: **Immutable** (breaking changes → storage-contract-v2)
   - **Use Case**: Third-party storage implementations (Firebase, DynamoDB, S3, etc.)
   - **Status**: Ready for publication

#### 2. **@aretw0/sync-contract-v1** (0.1.0)
   - **Purpose**: CRDT delta format for interoperable sync
   - **Conformance**: 4 validations
   - **Stability**: **Immutable**
   - **Use Case**: Loro, Automerge, or any CRDT can implement this interface
   - **Status**: Ready for publication

#### 3. **@aretw0/identity-contract-v1** (0.1.0)
   - **Purpose**: Capability contract for identity/signing
   - **Conformance**: 4 validations
   - **Stability**: **Immutable**
   - **Use Case**: Nostr, OPAQUE, custom identity systems can implement
   - **Status**: Ready for publication

---

## What's **Not** Being Published Yet (Tier 2)

### Reference Implementations (Mature in Private First)

These are the actual tools and systems. We keep them private for 3–6 months to stabilize before publishing.

| Package | v0.1.0 Status | Target Publication | Reason |
|---------|---------------|--------------------|--------|
| `tractor` (Rust) | Code ready, tests pass | May–June 2026 | Consumer testing (Gate 2/3) still WIP |
| `apps/me` (Homestead) | Gate 3 in progress | July+ 2026 | Needs 6+ months daily use to validate UX |
| **`plugin-manifest`** | **DEFERRED** | **v0.2.0 (July+ 2026)** | **See below** |
| `barn` (Plugin lifecycle) | SDD/BDD phase | May 2026 | Must be rock-solid for installPlugin() |
| `task-contract-v1` | Contract package implemented (TDD baseline) | v0.2.0 | In-memory adapter + conformance shipped; pending pi-agent/farmhand/storage-sqlite integration |
| `session-contract-v1` | Contract package implemented (TDD baseline) | v0.2.0 | In-memory adapter + conformance shipped; pending pi-agent namespace migration + storage-sqlite adapter |
| `silo` (Secrets) | Early design | June 2026 | Personal threat model; tailor to daily use |
| `creek` (Telemetry) | Planned | v0.2.0 | Personal observability; genericize later |
| `plugin-tem` (AI) | In progress | v0.2.0+ | Tightly personal; publish as example, not reference |
| `windmill` (Automation) | In progress | v0.2.0 | Personal workflows first; ecosystem later |

### Why `plugin-manifest` is Deferred to v0.2.0

The current `plugin-manifest` describes **WASM plugins only**. But Refarm's real extensibility spans **all layers**:

- **Pi layer** (IoT automaton, local scripts, hardware)
- **Tractor layer** (custom backends, indexing, business logic)
- **Homestead/Frontend layer** (UI widgets, sidebars, editors)
- **Electron/Desktop layer** (file system, OS integration)
- **Windmill/Automation layer** (workflow steps, custom actions)

Publishing `plugin-manifest` now locks us into **WASM-only thinking**. Instead, gatekeep publication until:
- [ ] Pi plugin format is designed
- [ ] Manifest schema generalizes across all 5 layers
- [ ] Inter-layer composition is proven (Pi plugin → Homestead widget)
- [ ] 3+ examples exist (WASM + Pi + Frontend)

**Target**: v0.2.0 publishes complete plugin ecosystem with multi-layer examples.

---

## Developer Experience (v0.1.0)

### For Contract Users
- Package READMEs with installation/usage examples
- Conformance tests runnable in external projects
- TypeScript declarations exported
- ESM-only (modern, no dual-bundle complexity)
- Zero runtime dependencies (pure types + validation logic)
- CI example for external projects
- Third-party plugin example in examples/third-party-plugin/

### For Daily Driver Users (You)
- Tractor daemon boots locally reliably
- Homestead ↔ Tractor integration (Gate 3) still stabilizing
- Plugin hot-swap validated (3+ plugins needed)
- Offline sync confirmed (7-day test required)
- 100% test coverage on implementations

---

## Publishing Configuration (Ready)

### npm package.json Fields
- `files` field (only dist + README shipped)
- `publishConfig.access: "public"`
- Repository/homepage URLs configured
- Version bumped to `0.1.0`

### CI/CD
- `publish-packages.yml` workflow exists
- Gate 1 (GitHub variables) pending: `RELEASE_AUTOMATION=true`, `RELEASE_OWNER=aretw0`
- NPM token provisioned in GitHub Secrets

---

## Publishing Timeline

### Phase A: Pre-Publish (This Week)
- [ ] Set `RELEASE_AUTOMATION=true` in GitHub repository settings
- [ ] Set `RELEASE_OWNER=aretw0`
- [ ] Verify `NPM_TOKEN` has publish access to @aretw0 scope
- [ ] Run `npm publish --dry-run` for each contract (should pass)

### Phase B: Publish (Next Week)
```bash
git tag @aretw0/storage-contract-v1@0.1.0 && git push origin @aretw0/storage-contract-v1@0.1.0
git tag @aretw0/sync-contract-v1@0.1.0 && git push origin @aretw0/sync-contract-v1@0.1.0
git tag @aretw0/identity-contract-v1@0.1.0 && git push origin @aretw0/identity-contract-v1@0.1.0
```
- CI triggers: `publish-packages.yml` publishes all 3 to npm

### Phase C: Post-Publish (Verification)
- [ ] Verify on npm: `npm info @aretw0/storage-contract-v1`
- [ ] Update this file with publish timestamps
- [ ] Create GitHub Release for `v0.1.0-contracts`
- [ ] Announce (optional)

### Phase D: Daily Driver Stabilization (Ongoing)
- Continue using Refarm as personal daily driver
- Complete Gate 2/3 (Tractor consumer testing)
- Mature Barn plugin lifecycle
- Begin Pi plugin design (blocks v0.2.0 plugin-manifest publication)
- Plan v0.2.0 publication (mid-2026)

---

## Repository State

- **Current version**: v0.0.1-dev
- **Next version**: v0.1.0 (3 contracts only; core kernel stays v0.0.x)
- **Scope**: @aretw0 (personal profile until org migration)
- **Branch**: main (releases only); develop (daily development)
