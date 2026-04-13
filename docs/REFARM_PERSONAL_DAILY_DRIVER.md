# Refarm as a Personal Daily Driver

> **Decision Point**: Refarm is not a generic platform. It's a **personal sovereign workspace** for the creator (and eventually contributors) to live and work in. This changes everything about prioritization.

---

## Core Premise

**You are the user.** Refarm succeeds when you can replace your daily tools with it:

- 🧩 **Work Assembly** — tasks, projects, notes, links in one sovereign space
- 📝 **Knowledge Graph** — articles, research, decision logs, interconnected
- 🤖 **Automation** — workflows, scripts, reminders that serve your needs
- 🔐 **Identity** — your cryptographic keys, signed work, portable provenance
- 📱 **Mobility** — works without cloud sync, across devices (desktop, tablets, Pi)
- 🧠 **Intelligence** — local AI queries over your graph, LLM-backed reasoning

---

## The Personal User: You

**Problem Statement:**
- Scattered tools: GitHub issues, Notion, Signal chats, terminal notes, doc fragments
- No single source of truth for work/life data
- No real offline-first experience (everything requires sync back to proprietary cloud)
- Can't query your own history effectively
- No cryptographic proof of authorship or ideas

**Goal:**
- One place to think, organize, and execute — **owned entirely by you**
- Sovereign backup and recovery — portable across devices
- Machine-friendly queries and automation
- Cryptographic identity for signed work
- Runs on cheap hardware (Raspberry Pi, old laptop, browser)

---

## Publishing Strategy for v0.1.0

### TIER 1: Publish NOW (Minimal, Foundational, Contracts-First)

These packages form the **substrate** that others can build on. They answer: "What is a Refarm-compatible system?"

**For npm**:
1. **`@aretw0/storage-contract-v1`** — Interface for any system to speak "Refarm storage"
   - 6 conformance tests ✅
   - Ready for third-party implementations
   - Stability: **IMMUTABLE** (breaking changes → v2 contract)

2. **`@aretw0/sync-contract-v1`** — CRDT delta format for interoperable sync
   - 4 conformance tests ✅
   - Enables Loro, Automerge, or other CRDTs to plug in
   - Stability: **IMMUTABLE**

3. **`@aretw0/identity-contract-v1`** — Keypair/signature interface
   - 4 conformance tests ✅
   - Nostr, OPAQUE, or custom identity stacks can implement
   - Stability: **IMMUTABLE**

4. **`@aretw0/plugin-manifest`** — WASM plugin descriptor schema
   - Used to validate and load plugins
   - Stability: **IMMUTABLE**

**Rationale**: These are **contracts**, not implementations. They're small, stable, and let the ecosystem answer: "How can I build for Refarm?"

### TIER 2: Keep Private (Mature in Closed, Then Open-Source)

These are the **reference implementations** and personal tools. Publish after you've used them for 3–6 months and the API surface has stabilized.

**Keep in `/workspaces/refarm` (private monorepo)**:

1. **`apps/me` (Homestead + Studio)** — Your personal distro
   - Gate 3 still in progress
   - Needs 6 months of daily use to stabilize UX
   - **Publish later** as `@aretw0/refarm-personal` (reference implementation for solo users)

2. **`packages/tractor`** (Rust daemon)
   - ✅ Technically ready (52/52 tests, ADR-048 graduated)
   - **BUT**: Consumer testing still WIP (Gate 2/3)
   - **Publish after** Gate 3 finishes (when Homestead ↔ Tractor integration proven)
   - Target: **mid-late April 2026** (next sprint)

3. **`packages/silo`** (Secret provisioning)
   - Your personal secret manager
   - Not a generic library; tailored to your threat model
   - **Publish later** if others adopt the pattern

4. **`packages/barn`** (Plugin lifecycle, OPFS, SHA-256)
   - Mature this in your daily workflow first
   - Needed for `installPlugin()` to be rock-solid
   - **Publish after** you've hot-swapped plugins dozens of times

5. **`packages/creek`** (Telemetry, logging)
   - Your observability into Refarm's own health
   - Personal at first, genericizable later
   - **Keep private** until v0.2.0

6. **`packages/plugin-tem`** (AI/LLM reasoning)
   - Tightly coupled to your reasoning preferences (Claude, local models, etc.)
   - Personal tool
   - **Keep private** until v1.0 (or publish as example, not reference)

7. **`packages/windmill`** (Automation/workflows)
   - Initially for your tasks/reminders/macros
   - **Mature in private**, publish as "personal automation examples"

---

## API Stability Tiers

```
TIER 1 (npm, v0.1.0)          TIER 2 (Private, Gate 3) → TIER 1 (npm v0.2.0)
─────────────────────────────────────────────────────────────────────────
✅ Contracts (Immutable)        🚧 Reference Implementations (Evolving)
   • storage-contract-v1           • tractor (Rust)
   • sync-contract-v1             • apps/me (Homestead)
   • identity-contract-v1         • barn (Plugin mgmt)
   • plugin-manifest              • silo (Secrets)
                                  • creek (Telemetry)
                                  • plugin-tem (AI)
                                  • windmill (Automation)
```

---

## v0.1.0 Acceptance Criteria (Revised)

### For Publishing (TIER 1 Contracts)

- [x] 4 contracts have conformance tests
- [x] Contract documentation with examples
- [ ] **NEW**: Gateway credentials configured (@aretw0 npm scope)
- [ ] First publish workflow tested (dry-run → actual)

### For Your Daily Use (TIER 2, keeps you productive)

- [ ] Gate 3: Homestead ↔ Tractor end-to-end sync stable (50+ edits, offline → reconnect)
- [ ] Gate 2: All 7 Tractor consumers working with production `.db`
- [ ] `installPlugin()` tested with at least 3 plugins (Barn integration)
- [ ] Offline-first confirmed: restart browser, edit before connecting to tractor, sync on reconnect
- [ ] One week of daily use without crashes or data loss

### For Ecosystem Growth (Later, v0.2.0+)

- [ ] Third-party reference implementation (someone else implements `storage-contract-v1`)
- [ ] Tractor documentation stable enough for others to run  locally
- [ ] Plugin examples: at least 3 published plugins (even if personal)

---

## Repository Posture

- **Public github.com/aretw0/refarm** — Source available, read-only for outsiders
- **Private development** — You work in `develop`, release `main` when ready
- **Contracts published** — Low risk (interface, not implementation)
- **Personal tools private** — No external pressure to maintain them
- **Future**: Migrate to `@refarm.dev` org for team collaboration if needed

---

## Publishing Checklist for v0.1.0

### Pre-Publish (Do Now)

- [ ] **Gate 1**: Set `RELEASE_AUTOMATION=true` in GitHub repo settings
- [ ] **Gate 1**: Set `RELEASE_OWNER=aretw0` to prevent accidental publishes
- [ ] **Gate 1**: Ensure `NPM_TOKEN` has publish access to `@aretw0` scope
- [ ] **Contracts**: Update all 4 contract `package.json` with `"version": "0.1.0"`
- [ ] **Contracts**: Run `npm run type-check` + `npm run test` for each
- [ ] **Contracts**: Validate `npm publish --dry-run` for each

### Publish (After Gate 1)

```bash
# In order, publish the 4 contracts
git tag @aretw0/storage-contract-v1@0.1.0 && git push origin @aretw0/storage-contract-v1@0.1.0
git tag @aretw0/sync-contract-v1@0.1.0 && git push origin @aretw0/sync-contract-v1@0.1.0
git tag @aretw0/identity-contract-v1@0.1.0 && git push origin @aretw0/identity-contract-v1@0.1.0
git tag @aretw0/plugin-manifest@0.1.0 && git push origin @aretw0/plugin-manifest@0.1.0

# CI runs: publish-packages.yml triggers, publishes all 4 to npm
```

### Post-Publish (Immediately After)

- [ ] Verify contracts appear on npm: `npm info @aretw0/storage-contract-v1`
- [ ] Update [DISTRIBUTION_STATUS.md](./DISTRIBUTION_STATUS.md) with publish dates + npm links
- [ ] Create GitHub Release for `v0.1.0-contracts` with changelog
- [ ] Announce (optional): Twitter, Matrix, personal network

### Defer (To v0.2.0 or Later)

- [ ] `tractor` (Rust) — publish only after 6+ weeks daily use
- [ ] `apps/me` — publish as "example personal distro" reference, not mandatory
- [ ] All infrastructure plugins — keep private until you need external contributions

---

## Communication

**To contributors/ecosystem** (README, docs):
> "Refarm v0.1.0 publishes **capability contracts** only. These define how any system can implement Refarm-compatible storage, sync, and identity. Reference implementations (tractor, Homestead, plugins) will mature privately and release later as v0.2.0+. For now, see [INSPIRATIONS.md](./INSPIRATIONS.md) and [DEVELOPING.md](../docs/DEVELOPMENT_RESOLUTION.md) to understand the vision."

**To yourself** (in this doc):
> "You are the daily user. Publish contracts. Keep your tools private. Validate for 6 months. Release reference implementations when stable."

---

**See Also**:
- [RELEASE_POLICY.md](./RELEASE_POLICY.md) — Kernel / Apps / Plugins velocity
- [v0.1.0-release-gate.md](./v0.1.0-release-gate.md) — Technical gates (still applies)
- [USER_STORY.md](./USER_STORY.md) — Update with personal user journey
