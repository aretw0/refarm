# ADR-095: Surface-Neutral Model Account Resolution

**Status**: Proposed
**Date**: 2026-08-06
**Authors**: Arthur Silva, Codex
**Related**: [ADR-012](ADR-012-hybrid-model-routing-for-agent-harness.md),
[ADR-063](ADR-063-cli-oauth-strategy.md),
[ADR-077](ADR-077-silo-protected-secret-envelope.md),
[ADR-088](ADR-088-agent-surface-transport-seam.md),
[ADR-094](ADR-094-node-context-workspace-hatch-and-sovereign-home-resolution.md)

## Context

Refarm has more than one way to converse with or dispatch work to an agent. `refarm ask` and
`refarm chat` already converge on model-route resolution and `createRuntimeAgentRespondEffort`, and
future sessions, workers, monitors, Telegram, PWA, and plugin surfaces need the same model access.

At the same time, one provider may have zero or more credential identities on a node. If each
surface resolves credentials, reads Silo, or defines its own fallback rules, account isolation and
billing attribution will drift. Making either `ask` or `chat` the privileged integration point would
also force future surfaces to depend on an app-specific contract.

## Decision

Provider, model-account, and workspace-binding resolution is a surface-neutral model-dispatch
capability below all conversational and automation surfaces.

A consumer submits a dispatch intent with:

- an extensible, descriptive consumer identity;
- resolved node/workspace/session context;
- route intent such as provider, model, or routing profile;
- an optional explicit credential override that was already authorized.

The resolver returns an immutable selection snapshot containing the provider, model, opaque
credential id and revision, workspace, and selection source. Only the host-side dispatch boundary
loads and injects the selected secret.

The credential precedence is one contract for every consumer: authorized explicit override,
node-owned workspace binding, the sole eligible node credential, then typed refusal. Cwd, last
login, last-used account, ambient CLI state, and surface identity are not selectors.

Consumer identity is not a closed enum and is not authorization by itself. Capabilities, workspace
egress policy, and node context authorize dispatch. A new surface must be able to consume the seam
without adding a provider adapter, credential store reader, or precedence branch.

`refarm ask` and `refarm chat` are initial conformance consumers. For the same authorized
workspace and route intent, they must resolve the same credential snapshot; their differences belong
to conversation lifecycle and presentation.

## Boundary

- The model-account contract owns descriptors, bindings, selection inputs/results, and refusals.
- Silo owns protected secret envelopes and redacted secret descriptors, not routing policy.
- Provider adapters own login/refresh/request auth and credential-scoped catalogs.
- The agent/router owns model capability and fallback policy after the authorized account boundary.
- Surfaces own input, approval choreography, continuity, and projection only.
- External agent runtimes, such as a possible Copilot SDK/CLI integration, register as a distinct
  runtime capability and do not masquerade as a raw model provider.

## Consequences

### Positive

- Same-provider multi-account isolation is testable once and reused everywhere.
- New surfaces do not duplicate secret access or provider behavior.
- Usage, policy, and budget observations retain one account/workspace attribution path.
- `ask`, `chat`, and remote channels can evolve independently of provider implementation.

### Costs and risks

- Existing surface-specific route assembly must converge on a typed dispatch intent.
- The current closed `source` union in `runtime-agent-effort.ts` will need an extensible identity
  without weakening authorization.
- Account resolution and model routing must remain ordered: model fallback cannot reopen credential
  selection and cross an account or egress boundary.

## Alternatives considered

- **Prioritize and integrate through `refarm ask`.** Rejected because `chat` and future consumers
  are peers, and the provider contract is not an ask feature.
- **Let each surface select credentials.** Rejected because precedence, redaction, and fallback would
  drift and become difficult to audit.
- **Make `refarm chat` the canonical agent surface.** Rejected for the same coupling reason; chat
  owns continuity and UX, not provider identity.
- **Let the provider choose its current account.** Rejected because upstream CLI state and last
  login are ambient, mutable, and unsafe for concurrent workspaces.

## Operationalization

Implementation is sequenced by the linked plan: freeze the account contract and migrations,
establish the shared dispatch seam, expose operator lifecycle and binding, then run independent
Kimi and Copilot canaries. Each promotion remains reversible and provider/runtime specific.

The decision is operational when:

1. two credentials for one provider resolve independently by opaque workspace binding;
2. ambiguity refuses identically through `ask`, `chat`, and the pure resolver;
3. equal intents through `ask` and `chat` select the same credential revision;
4. a new test consumer uses the seam without importing Silo or provider modules;
5. fallback, retries, and external runtimes cannot change credential identity implicitly.

## References

- [Account-aware Copilot and Kimi design](../../docs/superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md)
- [Account-aware model provider feature](../features/account-aware-model-provider-contract.md)
- [Implementation plan](../../docs/superpowers/plans/2026-08-06-account-aware-model-providers.md)
