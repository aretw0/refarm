# Sprint 1: Executable Contracts vs. Future Architecture

**Reality Check**: Distinguir entre "contrato testável/publicável AGORA" vs "visão arquitetural para Sprint 2+"

---

## What's Actually Executable Right Now (Release-Ready)

### ✅ Tier 1: Capability Contract Packages (TESTED, PUBLISHABLE)

| Package | Tests | Status | Can do --dry-run? |
|---------|-------|--------|------------------|
| `@refarm.dev/storage-contract-v1@0.1.0` | ✅ 6 conformance tests | Ready | ✅ YES |
| `@refarm.dev/sync-contract-v1@0.1.0` | ✅ 2 smoke tests | Ready | ✅ YES |
| `@refarm.dev/identity-contract-v1@0.1.0` | ✅ 2 smoke tests | Ready | ✅ YES |
| `@refarm.dev/plugin-manifest@0.1.0` | ✅ 2 validation tests | Ready | ✅ YES |

**Process**:
```bash
# This works TODAY
git tag @refarm.dev/storage-contract-v1@0.1.0
git push origin @refarm.dev/storage-contract-v1@0.1.0

# GitHub Actions runs publish workflow
# npm publish --dry-run passes ✅
# npm publish succeeds ✅
```

**Total test coverage**: ~12 tests (6s runtime)  
**Total ready for release**: 4 packages

---

### ⚠️ Tier 2: Kernel Smoke Tests (PARTIAL)

| Component | Tests | Implementation Status | In Sprint 1? |
|-----------|-------|----------------------|--------------|
| `apps/kernel` | ✅ 2 smoke tests | Partial (node normalization + plugin lifecycle) | YES |
| `packages/storage-sqlite` | ✅ 1 smoke test | Partial (idempotent migration) | YES |
| `packages/sync-crdt` | ✅ 2 smoke tests | Partial (CRDT merge + operations) | YES |

**What these test**:
- Kernel can normalize a JSON payload into a sovereign node
- Plugin loader can track lifecycle (load, execute, error)
- CRDT can merge and dispatch operations
- Storage can run migrations idempotently

**What they DON'T test**:
- Multi-device sync convergence
- Full graph versioning (commit/branch/revert)
- Plugin citizenship monitoring
- Self-healing from corruption

**Status**: Foundation layer, NOT feature-complete.

---

## What's ONLY Documentation (No Tests Yet)

### ❌ Tier 3: Proposed Architectures (DESIGN ONLY)

| ADR | Title | Implementation | Tests | Targetted |
|-----|-------|----------------|-------|-----------|
| [ADR-007](../specs/ADRs/ADR-007-observability-primitives.md) | Observability Primitives | 🔴 DRAFT (pseudocode) | ❌ 0 tests | v0.2.0 |
| [ADR-020](../specs/ADRs/ADR-020-sovereign-graph-versioning.md) | Graph Versioning | 🔴 PROPOSED (pseudocode) | ❌ 0 tests | v0.2.0-0.3.0 |
| [ADR-021](../specs/ADRs/ADR-021-self-healing-and-plugin-citizenship.md) | Self-Healing | 🔴 PROPOSED (pseudocode) | ❌ 0 tests | v0.3.0+ |

**What exists**:
- Detailed design specs
- Code examples (pseudocode)
- Testing protocols (how to validate)
- Integration diagrams

**What does NOT exist**:
- Actual implementation
- Running tests
- Ability to `npm publish` or `--dry-run`
- Kernel API contracts

**Reality**: These are **direction setting** for future sprints, not Sprint 1 deliverables.

---

## Sprint 1 Scope: What You Can Actually Do

### Release (Post-Org-Transfer)

```bash
# Create first release with Changesets
changeset add

# Select: 4 packages
# - @refarm.dev/storage-contract-v1: patch (0.1.0 → 0.1.1)
# - @refarm.dev/sync-contract-v1: patch
# - @refarm.dev/identity-contract-v1: patch
# - @refarm.dev/plugin-manifest: patch

# Workflow runs:
npm run lint --workspaces           # ✅ Pass
npm run type-check --workspaces     # ✅ Pass
npm run test:capabilities           # ✅ Pass (6 tests in ~6s)
npm publish --dry-run               # ✅ Pass

# Actual publish happens
npm publish                          # ✅ Available on npm
```

**Guaranteed working**: Yes (CI validates it)  
**Test coverage for what ships**: Yes (~12 tests)  
**Documentation**: Yes (READMEs + usage examples)

### What's NOT Included in Sprint 1 Release

| Feature | Why (be honest) |
|---------|-----------------|
| Graph versioning (commit/branch/revert) | Design exists, zero implementation or tests |
| Plugin citizenship monitoring | Design exists, zero implementation or tests |
| Self-healing from corruption | Design exists, zero implementation or tests |
| Observability SDK | ADR-007 is draft, incomplete |
| Third-party plugin ecosystem | No marketplace, no publishing workflow |

---

## Honest Assessment: Two Options Now

### Option A: Release Only What's Tested (Recommended)

**Sprint 1 Release (v0.1.1)**:
- 4 capability contracts + 12 conformance tests
- Kernel smoke tests (foundation layer)
- Documentation of contracts
- CI/CD publish workflow

**Marketing**: *"Public release of Refarm capability contracts. Stable type definitions and conformance tests for plugin developers."*

**Then**:
- Sprint 2: Implement ADR-007 (Observability) with tests
- Sprint 2-3: Implement ADR-020 (Graph Versioning) with tests
- Sprint 3+: Implement ADR-021 (Self-Healing) with tests

**Pros**: 
- ✅ Everything that ships has tests
- ✅ Zero broken promises
- ✅ Clear roadmap

**Cons**: 
- First release is "building blocks only" (contracts, not full app)

### Option B: Release with Features + Aspirational Roadmap (Risky)

**Sprint 1 Release (v0.1.1 + v0.2.0 Road)**:
- 4 capability contracts + tests ✅
- Kernel smoke tests ✅
- Roadmap document showing ADR-020, ADR-021 coming in v0.2/0.3

**Problem**: 
- ❌ Nothing new to show beyond contracts
- ❌ Roadmap is just words without proof
- ❌ User tries to use Graph Versioning in v0.1.1 → not there → disappointment

---

## My Recommendation

### Sprint 1: Release Contracts Only (Option A)

```
Commit: docs(architecture): distinguish executable vs. proposed contracts

EXECUTABLE (v0.1.1):
  ✅ @refarm.dev/storage-contract-v1@0.1.1
  ✅ @refarm.dev/sync-contract-v1@0.1.1
  ✅ @refarm.dev/identity-contract-v1@0.1.1
  ✅ @refarm.dev/plugin-manifest@0.1.1
  ✅ 12 conformance tests (pass)
  ✅ CI/CD publish workflow (works)

PROPOSED (v0.2.0-0.3.0 roadmap):
  📋 ADR-007: Observability Primitives (Sprint 2)
      - Event emission/subscription SDK
      - Pluggable observers (Sentry, Grafana, custom)
      - Status: Design complete, implementation TBD

  📋 ADR-020: Graph Versioning (Sprint 2-3)
      - commit(), branch(), checkout(), revert() primitives
      - 5 invariant tests (reproducibility, causal consistency, sync safety, etc.)
      - Status: Design complete, tests TBD, implementation TBD

  📋 ADR-021: Self-Healing (Sprint 3+)
      - Storage integrity (checksums, WAL, recovery)
      - Plugin citizenship monitoring
      - Kernel policies (auto-heal, isolation)
      - Status: Design complete, tests TBD, implementation TBD
```

### Why This Makes Sense

1. **Honest**: You're saying "here's what works, here's what's coming"
2. **Motivated**: First users see tested, documented contracts
3. **Roadmap**: ADRs give crystal clarity on direction
4. **Gating**: Forces next sprint to implement + test what's promised
5. **No bloat**: You're not shipping code with zero tests

---

## What Needs to Happen Before v0.2.0

Each of these **must** have before shipping:

### ADR-007 Implementation Checklist (for v0.2.0)

```
[ ] Kernel event emission API implemented + tested
[ ] Plugin observation hooks in contracts + tested
[ ] At least one observer plugin (StudioDevTools)
[ ] Integration test: end-to-end event flow
[ ] Performance test: overhead < 5% under load
[ ] Example: custom observer plugin
```

### ADR-020 Implementation Checklist (for v0.2.0-0.3.0)

```
[ ] Commit storage + retrieval (WAL-backed)
[ ] Branch ref management
[ ] Checkout state restoration (with reproducibility test)
[ ] Revert with compensating operations
[ ] Invariant 1 test: Reproducibility (50+ iterations)
[ ] Invariant 2 test: Causal consistency (multi-device)
[ ] Invariant 3 test: Sync safety (offline scenarios)
[ ] Invariant 4 test: Schema continuity (old→new)
[ ] Invariant 5 test: Performance (10k commits)
```

### ADR-021 Implementation Checklist (for v0.3.0+)

```
[ ] Checksum validation on read/write
[ ] Write-ahead log (WAL) implementation
[ ] Schema downgrade fallback
[ ] Plugin citizenship monitoring API
[ ] Health score calculation (rules engine)
[ ] State transitions (healthy→degraded→isolated)
[ ] Integration test: bad plugin is isolated before system breaks
[ ] Boot recovery test: recover from WAL after crash
```

---

## Updated Roadmap

| Version | Scope | Contract Status | Test Coverage |
|---------|-------|-----------------|---------------|
| **v0.1.0** (now) | Pre-release, contracts only | Proposed | 12 tests |
| **v0.1.1** (Sprint 1 release) | Publish 4 contracts | Executable | 12 tests ✅ |
| **v0.2.0** (Sprint 2-3) | ADR-007 (Observability) | Executable | 20+ new tests |
| **v0.2.1-v0.3.0** (Sprint 3-4) | ADR-020 (Graph Versioning) | Executable | 30+ invariant tests |
| **v0.3.0+** (Sprint 4+) | ADR-021 (Self-Healing) | Executable | 40+ integration tests |
| **v1.0.0** | All 5 invariants + feature-complete | Production-ready | 100+ tests |

---

## Bottom Line for You

**What you're releasing** (v0.1.1):
- Contracts ✅ (tested, documented, publishable)
- Kernel foundation ✅ (smoke tests passing)
- Architecture vision 📋 (ADRs clear, detailed)

**What you're NOT releasing** (but have roadmap for):
- Graph versioning ❌ (design done, code next)
- Self-healing ❌ (design done, code later)
- Observability SDK ❌ (draft ADR, implementation next)

**Meta-point**: Versioning is critical for you. ADR-020 + ADR-021 are **exactly** what you need. But they're NOT in Sprint 1 code — they're in Sprint 2+ when you can back them up with tests and releases.

Does this align with your "contrato = testável + publicável" definition?
