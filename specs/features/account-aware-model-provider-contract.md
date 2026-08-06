# Feature: account-aware model provider contract

**Status**: Draft
**Version**: post-v0.1.0 provider lane
**Owner**: Refarm core maintainers

## Summary

Allow a node to hold multiple credential identities for the same model provider and select one
deterministically for a workspace and dispatch, independently of whether work originated in
`refarm ask`, `refarm chat`, automation, or a future remote surface.

## Scope and boundary

**In scope**:

- [ ] opaque credential identity plus operator-renamable alias;
- [ ] node-owned model-account descriptor catalog and protected secret reference;
- [ ] node-owned workspace/provider binding;
- [ ] pure, surface-neutral, fail-closed selection;
- [ ] credential-scoped model, policy, usage, and health observations;
- [ ] migration from current single-credential records;
- [ ] Kimi Open Platform canary and independent Copilot transport/runtime spikes.

**Out of scope**:

- [ ] aliases with fixed meanings such as `personal` or `corporate`;
- [ ] secrets stored in workspace repositories;
- [ ] surface-specific provider implementations;
- [ ] implicit account switching on quota, error, cwd, last login, or ambient CLI state;
- [ ] treating Kimi API, Kimi Code, and consumer Kimi membership as one product;
- [ ] treating the Copilot SDK/CLI runtime as a raw model provider without evidence.

## User stories

**As an operator**, I want any number of accounts for one provider with aliases meaningful to me,
so I can keep work, entitlement, policy, and billing boundaries separate.

**As a workspace owner**, I want a local node binding to an opaque credential id, so repository
content never contains my token, login, or machine-specific alias.

**As a surface author**, I want one model-dispatch contract, so a new chat or automation surface
does not learn how credentials are stored or selected.

## Acceptance criteria

1. Given two eligible credentials for one provider and an explicit workspace binding, every
   authorized consumer resolves the bound opaque id and revision.
2. Given two eligible credentials and no binding or authorized override, resolution returns
   `model_credential_ambiguous`; it never selects last login or ambient state.
3. Renaming an alias does not alter credential id, secret, binding, revision history, or usage.
4. Credential listing returns descriptors and protection state without returning secret values.
5. An incomplete descriptor or unclaimed secret is visible for repair but ineligible for routing.
6. `ask` and `chat` with equal node/workspace/route intent select equal credential snapshots.
7. A new consumer can dispatch without importing Silo or a provider-specific adapter.
8. Retry, model fallback, quota exhaustion, and provider failure do not cross credential or egress
   boundaries implicitly.
9. Copilot direct-provider and SDK/CLI runtime results are promoted independently.
10. Kimi Open Platform usage and errors are attributed to credential, project/workspace, and actual
    model without claiming Kimi Code entitlement.

## Bounded context and language

**Bounded context**: model account and dispatch authorization

- `provider`: transport and billing product;
- `credential identity`: opaque node-local identity eligible for a provider;
- `alias`: mutable operator label with no semantic role in routing;
- `binding`: node-owned workspace/provider to credential-id mapping;
- `dispatch intent`: surface-neutral request for an authorized model route;
- `selection snapshot`: immutable provider/model/credential decision for one dispatch;
- `consumer surface`: descriptive origin of a dispatch, not authorization by itself.

## Contract sketch

```typescript
interface ModelDispatchIntent {
	consumerSurface: string;
	workspaceId?: string;
	sessionId?: string;
	provider?: string;
	model?: string;
	profile?: string;
	credentialOverride?: string;
}

interface ModelDispatchSelection {
	workspaceId?: string;
	provider: string;
	model: string;
	credentialId: string;
	credentialRevision: string;
	source: "explicit" | "workspace-binding" | "sole-eligible";
}
```

The implementation may refine field names, but must preserve the separation and observable
semantics. Authorization metadata is resolved outside the descriptive `consumerSurface` field.

## Traceability Matrix

| Requirement | Architecture | Detailed design | Evidence target |
| --- | --- | --- | --- |
| surface-neutral resolution | ADR-095 | SDD D3 | pure resolver + ask/chat parity tests |
| node-owned secret/binding | ADR-077, ADR-094, ADR-095 | SDD D1-D2 | Silo descriptor and binding fixtures |
| provider-specific boundaries | ADR-095 | SDD D4-D9 | Kimi and Copilot canaries |
| no cross-account fallback | ADR-012, ADR-095 | SDD D3/D9 | router refusal tests |

## Execution Plan

- [x] architectural boundary recorded in ADR-095;
- [x] provider research and decisions consolidated in the canonical SDD;
- [x] implementation plan names atomic slices and evidence commands;
- [ ] contract and migration fixtures fail for missing behavior;
- [ ] pure resolver and redacted catalog pass;
- [ ] `ask`/`chat` parity and new-consumer conformance pass;
- [ ] provider canaries pass their independent promotion gates.

## References

- [ADR-095](../ADRs/ADR-095-surface-neutral-model-account-resolution.md)
- [Canonical SDD](../../docs/superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md)
- [Implementation plan](../../docs/superpowers/plans/2026-08-06-account-aware-model-providers.md)
