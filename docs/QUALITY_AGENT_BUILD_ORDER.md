# Build Order — Quality + Agent + Demonstration

**Purpose:** a single entry point that makes this thread easy to action. The refarm blocks compose into
**secure extensibility with a quality gate**: the agent is the engine, `quality:v1` is the declared-lint
primitive, sandboxed checker plugins are the gate, and the demonstration is the showcase. Everything below
is generic ecosystem work; downstream consumers own their profiles, personas, and content.

**One rule governs the order — distribute-first:** build *and* publish/hand off a block before anything
composes over it, so every demonstration is working software over distributed blocks, never a mock.

## Build order

| # | Item | Spec / doc | Status | Next action |
|---|------|-----------|--------|-------------|
| 1 | `quality:v1` contract | `specs/features/2026-07-02-quality-contract-v1.md` | designed | implement `packages/quality-contract-v1` (types + `runQualityV1Conformance`) |
| 2 | reference checker plugins (text-tells, design-tells) | quality-contract-v1 §2 | designed | build the two Rust→WASM checkers + distribute; the native text suite conforms as a downstream proof |
| 3 | agent engine (`pi-agent` / farmhand) | README boundary + `docs/DAILY_DRIVER_PARITY.md` | ✅ **unheld** (public) | close the parity gaps (live policy bundle: host shell policy, resumable sessions, durable memory) → `v0.1.0` |
| 4 | agents-lab bridge | `docs/superpowers/specs/2026-05-14-agents-lab-portability.md` | contracts exist | implement the **farmhand skill engine-binding** (satisfy `SkillEngineBindingEnvelope` for `pi-agent` + wire ADR-022 policy). The contracts (`skill-contract-v1`, ADR-022 policy, `capability-index`) already exist — this is implementation, not design |
| 5 | secure-extensibility demonstration | `specs/features/2026-07-02-secure-extensibility-demonstration.md` | designed | wire the smoke: install agent + 2 checker plugins + deterministic scaffold + `quality:v1` gate |
| 6 | extract accreted logic → shared primitives | pi-agent README boundary | 🔮 flagged | when the boundary bites: `tool_dispatch`/`structured_io`/state → primitives (keeps farmhand minimal) |

## Cross-references touched (no restated contracts)

- `specs/features/plugin-security-model.md` — the `quality:v1` checker is the canonical minimal-capability
  (`requiredCapabilities: []`) plugin example.
- `specs/features/2026-06-25-skill-runtime-activation.md` — authoring a skill (not just invoking) is the
  bidirectional-extensibility axis the demonstration uses.

## How to action a step

Each row's spec is self-contained: read it, implement against it, prove it (conformance / smoke), then mark
it distributed. Steps 1–4 unblock step 5; step 6 is deferred refactor that does not block distribution. The
agent (step 3) is already distributable — its remaining work is the parity checklist, not a redesign.
