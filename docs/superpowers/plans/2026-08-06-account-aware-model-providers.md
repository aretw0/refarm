# Account-aware model providers — implementation plan

**Goal:** Implement multiple credential identities per provider once, below all Refarm surfaces,
then prove Kimi Open Platform and the two distinct Copilot integration tracks against that contract.

**Architecture:** A pure model-account resolver consumes node context, workspace binding, eligible
credential descriptors, and route intent. It returns an immutable dispatch selection. Silo stores
secret envelopes and redacted descriptors; surfaces submit intents and never select or load secrets.
Provider adapters derive request auth for the selected identity. External agent runtimes register
through a separate capability boundary.

**Spec:**
[canonical SDD](../specs/2026-08-06-account-aware-copilot-kimi-providers-design.md),
[ADR-095](../../../specs/ADRs/ADR-095-surface-neutral-model-account-resolution.md),
[feature contract](../../../specs/features/account-aware-model-provider-contract.md)

## Global constraints

- Do not encode `personal`, `corporate`, email, organization, or alias as an account type.
- Do not write secrets or node-local bindings into workspace repositories.
- Do not let `ask`, `chat`, or another surface import Silo or provider login code.
- Do not let model fallback reopen credential selection.
- Do not copy another product's OAuth client id, integration headers, or private identity.
- Treat Copilot direct-provider and official SDK/CLI runtime as independent promotion tracks.
- Keep Kimi Open Platform, Kimi Code, and consumer membership separate.
- End each atomic implementation slice with the repository's operator gates.

## Slice 0 — Freeze contract and migration fixtures

**Likely areas:** a new source-level model-account contract package or the narrowest existing core
package; `packages/silo/src`; `apps/refarm/src/credentials`; command contract tests.

- [ ] Inventory the live flat OAuth/API-key storage shapes and capture fixtures before mutation.
- [ ] Define descriptor, secret reference, binding, dispatch intent/selection, revisions, and typed
  refusal codes.
- [ ] Add pure selection tests for explicit override, binding, sole eligible identity, ambiguity,
  incomplete/unclaimed records, and stale references.
- [ ] Add backward-compatible migration readers; do not delete legacy state during first read.
- [ ] Add redacted secret-descriptor listing without routing through value-returning `listSecrets`.

**Exit evidence:** two same-provider fixtures resolve independently; ambiguity and corrupt partial
states fail closed; no JSON/status result contains secret material.

## Slice 1 — Establish the surface-neutral dispatch seam

**Likely areas:** `apps/refarm/src/commands/model.ts`,
`apps/refarm/src/commands/runtime-agent-effort.ts`, `ask.ts`, `chat.ts`, and focused tests.

- [ ] Replace surface-owned account selection with one injected model-dispatch resolver.
- [ ] Make consumer identity extensible while keeping capability/workspace authorization separate.
- [ ] Carry the immutable credential id/revision snapshot through effort, runtime dispatch, usage,
  and diagnostics.
- [ ] Add `ask`/`chat` parity tests and a minimal synthetic third consumer.
- [ ] Prove no surface imports Silo or provider auth modules after the seam.

**Exit evidence:** equal intents from `ask` and `chat` select equal snapshots; adding the synthetic
consumer requires no credential precedence or provider branch.

## Slice 2 — Operator lifecycle and workspace binding

**Likely areas:** `apps/refarm/src/commands/model.ts`, credentials modules, node-owned workspace
registry/context source, command tests and JSON schemas.

- [ ] Implement aliased add/login/list/rename/remove and explicit bind/current commands.
- [ ] Persist bindings by opaque credential id; aliases remain mutable presentation.
- [ ] Verify upstream identity where available and distinguish verified, declared, and unknown facts.
- [ ] Make removal report affected workspace ids and require explicit force for referenced entries.
- [ ] Surface active one-dispatch environment overrides without silently importing them.

**Exit evidence:** rename preserves binding and history; restart preserves selection; every command
reports node/workspace context and redacts login/token values.

## Slice 3 — Kimi Open Platform canary

**Likely areas:** provider catalog/config, runtime model HTTP adapter, account verification and
provider conformance tests.

- [ ] Add `kimi-api` as the public Open Platform product with region and project dimensions.
- [ ] Implement documented model discovery, completion/streaming, cancellation, errors, and usage.
- [ ] Record actual model, cached tokens, balance/quota observations, and workspace/account usage.
- [ ] Test shared organization quota without pretending keys are independent pools.
- [ ] Reject Kimi Code or consumer membership credentials.

**Exit evidence:** an explicitly authorized workspace canary passes provider conformance and
redaction; rollback disables the provider without changing stored account identity.

## Slice 4A — Copilot direct-provider spike

- [ ] Register a Refarm-owned GitHub OAuth development identity and verify selected user identity.
- [ ] Implement provider-owned login, serialized refresh, and request-scoped auth derivation.
- [ ] Differential-test a pinned pi provider as an oracle without copying client/integration ids.
- [ ] Probe model discovery, policy consent, protocols, streaming, cancellation, and usage signals.
- [ ] Record whether GitHub supports the required transport contract and retain a disable switch.

**Exit evidence:** redacted transcripts prove two-account isolation and whether a Refarm-owned
identity works. A dependency on foreign identity or impersonation blocks promotion.

## Slice 4B — Copilot SDK/CLI external-runtime spike

- [ ] Pin SDK, CLI, and negotiated JSON-RPC protocol versions.
- [ ] Start in multi-tenant `empty` mode with explicit session credentials and no ambient CLI auth.
- [ ] Begin with one isolated process per credential; prove session ownership and lifecycle.
- [ ] Map tools, consent, streaming, cancellation, usage/AI-credit events, and concurrency locks.
- [ ] Classify it as an external agent runtime unless bounded-turn evidence proves provider
  equivalence without nesting an opaque agent loop.

**Exit evidence:** the runtime can be independently dispatched, authorized, accounted, disabled,
and rolled back. Passing Public Preview APIs is feasibility evidence, not stable promotion by itself.

## Slice 5 — Routing, budget, and promotion

- [ ] Make account eligibility and egress policy inputs to routing before model preference.
- [ ] Add credential-scoped catalog/policy revisions and explainable, PII-free route events.
- [ ] Model Kimi token cost and Copilot credits/legacy requests without inventing precision.
- [ ] Prove retries, quota exhaustion, and fallback never switch credential implicitly.
- [ ] Promote Kimi, Copilot direct provider, and Copilot external runtime independently.

**Exit evidence:** the bench explains provider, model, safe account alias/id, policy, allowance/cost,
and fallback; all unpromoted paths retain typed refusal.

## Validation economy

Use the narrowest test for each red/green step, then the package checkpoint. Before each atomic
commit run:

```bash
git diff --check
refarm agent finish --lane after-edit --run --json
```

After each atomic commit run `refarm agent finish --lane after-commit --run --json`. Run the handoff
lane whenever public CLI/JSON contracts change, and reserve broader package/runtime gates for the
checkpoint that actually crosses those boundaries.

## Completion definition

The work is complete only when the feature acceptance criteria have linked test evidence, operator
commands can diagnose selected account/context without secrets, `ask` and `chat` remain peer
consumers, and every provider/runtime has an independent promotion and rollback decision.
