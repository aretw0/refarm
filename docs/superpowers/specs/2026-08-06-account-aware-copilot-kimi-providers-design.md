# Account-aware model providers — GitHub Copilot and Kimi

Date: 2026-08-06
Status: RESEARCHED DESIGN — ready to split into implementation slices; no provider was activated by this document
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md)
Authority: canonical design for model-account identity, workspace binding, GitHub Copilot, and Kimi provider strata

## Outcome

Refarm must stop treating a model provider as if it implied exactly one credential. A provider is a
transport and billing product; a model account is an operator-controlled identity that may be
eligible for that provider. Routes select the former, while a node-owned binding selects the latter.

The first proving scenario is deliberately generic:

- two or more GitHub Copilot credential identities coexist on one node, each with an arbitrary
  operator-chosen alias;
- a workspace is explicitly bound to one of them without storing a token or GitHub login in that
  workspace's repository;
- two simultaneous dispatches cannot exchange credentials, policy, model lists, or usage records;
- an unbound route with more than one eligible account refuses as ambiguous instead of choosing the
  last login or an ambient environment variable;
- Kimi Open Platform uses the same account contract, proving that this is not Copilot-specific.

The initial Kimi route is the public, pay-as-you-go API. Kimi Code is a separate subscription
product and remains unavailable until its terms explicitly permit Refarm as a client. The initial
Copilot implementation must prototype the official Copilot SDK. Pi's internal Copilot transport is
useful evidence, but an undocumented GitHub endpoint is not a production contract.

## Scope and non-goals

This design specifies:

1. account-aware model credentials and their safe storage;
2. deterministic account selection by workspace and dispatch;
3. provider-specific transport, login, policy, usage, and billing boundaries;
4. migration from the current single-credential shape;
5. an implementation order and executable acceptance criteria;
6. which older documents this design narrows or supersedes.

It does not:

- activate Copilot or Kimi;
- copy OAuth client identifiers or private endpoints from another tool;
- decide that every workspace may send content to every provider;
- turn GitHub Copilot's SDK into a nested agent loop without proving the boundary;
- redesign Refarm's device identity, workspace authorization, or verifiable-credential contracts.

## Measured Refarm state

The repository already contains several parts of the feature, but they do not compose into
multi-account routing.

| Surface | Measured state on 2026-08-06 | Consequence |
| --- | --- | --- |
| `packages/config/src/model-routing.js` | `github-copilot` is a known subscription provider; Kimi is absent | Copilot is classified but not operational |
| runtime allow-list | only `openai-codex` is a runtime subscription provider | Copilot is correctly refused |
| default model | Copilot still defaults to `gpt-4o` | the static default has drifted from live catalogs |
| token schema | `oauthCredentials[provider]` and one active `oauthProvider` | a second account overwrites or hides the first |
| API-key schema | one `modelProvider` plus one `modelApiKey` | same limitation for Kimi or any API provider |
| `apps/refarm/src/commands/model.ts` | resolves one credential and injects one provider environment variable | dispatch has no account identity |
| `packages/silo` | supports owner-only, namespaced secret envelopes | correct primitive exists, but model-account metadata does not |
| workspace config | attributes asks and budgets to a workspace | attribution exists, account binding does not |
| Tractor/agent | owns Refarm's tool loop and direct provider requests | a second agent runtime may conflict with it |

`@refarm.dev/credentials-contract-v1` is intentionally not reused: it is the W3C verifiable
credentials and wallet capability. Model login material belongs in Silo's `model` secret namespace,
with a small model-account contract above it.

## What the pi ecosystem teaches — and what it does not

The curated `~/github/agents-lab` checkout and its installed pi packages were inspected without
modification.

Pi currently demonstrates these useful transport facts:

- GitHub device authorization, including a GitHub Enterprise host;
- exchange of a GitHub token for a short-lived Copilot token and endpoint discovery;
- a credential-specific model catalog and policy enablement;
- several Copilot protocols rather than one universal OpenAI-compatible shape;
- Kimi Code device authorization and an Anthropic-compatible coding endpoint;
- account-qualified quota observations such as `github-copilot/<account>`.

It does not solve Refarm's central requirement: its durable auth lookup is still fundamentally keyed
by provider, so it is a reference for login and wire behavior, not a multi-account architecture.
Its Copilot request path also depends on `copilot_internal`, an undocumented endpoint. Refarm may use
that behavior as a lab oracle and differential-test target, but must not adopt it as the stable
provider contract.

The agents-lab provider-assimilation work contributes one process rule: a provider is not promoted
because login succeeded. It advances only when identity, policy, privacy, cost/quota telemetry,
failure semantics, and rollback have been observed in a canary.

## Official product boundaries, checked 2026-08-06

### GitHub Copilot

Copilot billing is no longer accurately modeled as “subscription, therefore zero cost.” GitHub now
uses AI credits for current plans, with token-based model prices converted into credits. Request-
based premium-request accounting remains relevant to some legacy annual individual plans. Business
and Enterprise include pooled credits, can incur usage-based charges, and support budgets. Budget
exhaustion does not automatically fall back to a cheaper model.

Official references:

- billing and AI credits: <https://docs.github.com/en/copilot/concepts/billing>
- models and credit pricing: <https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing>
- organization and enterprise billing: <https://docs.github.com/en/copilot/concepts/billing/organizations-and-enterprises>
- usage budgets: <https://docs.github.com/en/copilot/concepts/billing/budgets-for-usage-based-billing>
- policy interaction: <https://docs.github.com/en/copilot/concepts/policies>

GitHub's own Copilot CLI remembers multiple accounts and exposes account list/switch commands. Its
documented credential precedence also shows the danger Refarm must avoid: explicit environment
tokens can silently override stored login state.

- CLI authentication and multiple accounts:
  <https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli>

GitHub now publishes a Copilot SDK for TypeScript, Python, Go, Rust, .NET, and Java. It communicates
with Copilot CLI over JSON-RPC, accepts an explicit GitHub token per client/session, documents an
`empty` mode for shared or multi-user runtimes, and emits usage information and AI-credit limits.
These are the supported seams Refarm should prototype.

- SDK introduction: <https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started>
- explicit authentication: <https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate>
- GitHub OAuth setup: <https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth>
- multi-tenancy: <https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/multi-tenancy>
- session limits: <https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/session-limits>
- streaming and usage events:
  <https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/streaming-events>

The SDK is an agent runtime, not merely a raw chat-completions endpoint. Its existence does not prove
that it can sit behind Refarm's existing agent loop. That compatibility is the first Copilot spike,
not an assumption.

### Kimi

“Kimi” identifies at least three credential and billing products that must not be collapsed:

| Refarm provider | Upstream product | Initial status | Billing |
| --- | --- | --- | --- |
| `kimi-api` | Kimi Open Platform / Moonshot API | implement first | public API, pay as you go |
| `kimi-coding` | Kimi Code subscription endpoint | gated | membership credits and time windows |
| none | consumer Kimi membership/chat | not a model provider | consumer entitlement |

Kimi Open Platform exposes an OpenAI-compatible API at `https://api.moonshot.ai/v1`. International
and China environments, Open Platform balances, Kimi membership, and Kimi Code benefits are
separate. The adapter must therefore record product and region, not just the Kimi brand.

- API overview: <https://platform.kimi.ai/docs/api/overview>
- product/balance separation: <https://www.kimi.com/help/kimi-api/api-overview>
- pricing: <https://www.kimi.com/help/kimi-api/api-pricing>
- troubleshooting and regional separation: <https://www.kimi.com/help/kimi-api/api-troubleshooting>

Kimi Code documents Anthropic- and OpenAI-compatible coding endpoints, membership credits, and
five-hour/weekly limits. Its benefit documentation also says the benefit is intended for personal
development and warns that using its API key with tools outside the supported list may be treated as
misuse. Refarm must not infer authorization from pi's working implementation.

- Kimi Code FAQ: <https://www.kimi.com/help/kimi-code/faq>
- membership guide: <https://www.kimi.com/help/kimi-code/membership-guide>
- benefit restrictions: <https://www.kimi.com/help/kimi-code/benefits>
- membership accounting: <https://www.kimi.com/help/membership/membership-overview>
- usage rule changes: <https://www.kimi.com/help/membership/update-rules>
- error semantics: <https://www.kimi.com/code/docs/en/kimi-code/error-reference.html>

`kimi-coding` stays behind a product-policy gate until Kimi lists Refarm as supported, gives written
permission, or publishes terms that clearly authorize a generic client. The gate is a product
boundary, not a technical limitation.

## Decisions

### D1 — Provider, model account, and workspace binding are separate identities

A provider describes protocol and billing product:

```json
{
  "provider": "github-copilot",
  "model": "<credential-advertised-model-id>"
}
```

A model account describes one credential-bearing identity on this node. Its stable id and its
human-chosen alias are different fields:

```json
{
  "credentialId": "model-account:01JEXAMPLE9TK8Q5M6W3Z",
  "provider": "github-copilot",
  "alias": "blue",
  "identity": {
    "status": "verified",
    "subject": "github:<immutable-id>",
    "host": "github.com"
  },
  "secretRef": "model/model-account:01JEXAMPLE9TK8Q5M6W3Z"
}
```

`credentialId` is generated, node-local, stable, and semantically opaque. `alias` is chosen and may
be renamed by the operator without changing bindings, history, or secret location. Aliases such as
`blue`, `account-03`, `client-x`, `personal`, or `corporate` all have exactly the same contract
meaning: none. Refarm does not prescribe an account taxonomy.

The cardinality is `0..N` credentials per provider, not a two-slot personal/corporate schema.
Aliases are unique only within a provider on the node, so `github-copilot/blue` and `kimi-api/blue`
may coexist. Limits, pagination, and health checks are operational controls over a collection; they
must not become a fixed schema limit on how many accounts an operator may register.

A display login may exist in protected node metadata but is not required in a workspace record,
public event, or budget ledger. `identity.subject` uses the provider's immutable identifier when one
can be verified; Kimi API keys may remain `unverified` with an operator alias. Billing owner,
content class, organization, project, cost center, and account purpose are optional metadata and
policy facts. They must never be inferred from the alias.

Two credential records may resolve to the same upstream subject but differ by tenant, project,
region, scopes, or billing context. Refarm warns when verified identity dimensions are identical,
but does not collapse the records automatically; an operator may intentionally keep separately
rotated credentials for the same upstream identity.

Provider aliases such as `github-copilot-blue` are forbidden. They multiply catalogs and hide
the fact that two routes share one protocol while having different identity, entitlement, policy,
and budget state.

### D2 — Secrets belong to the node; workspaces carry only bindings

Silo stores the secret envelope under namespace `model` and the credential id. A separate non-secret
catalog stores the descriptor. The current Silo protection is owner-only plaintext in a versioned
envelope; status output must disclose that honestly until opaque or hardware-backed protection
lands.

The node's sovereign workspace registry owns the binding and persists the opaque id, not the alias:

```json
{
  "modelBindings": {
    "workspaces": {
      "rcdc5": {
        "github-copilot": "model-account:01JEXAMPLE9TK8Q5M6W3Z"
      },
      "refarm": {
        "github-copilot": "model-account:01JEXAMPLE2CN7H4R8A0P",
        "kimi-api": "model-account:01JEXAMPLE6BT1S9V4D7K"
      }
    }
  }
}
```

This record must not be written into a project repository. A portable workspace declaration may
state that it requires or permits a provider, but the local node maps that requirement to a local
credential. This composes with the hatch design's `inherit-node`, `workspace-owned`, and
`explicit-provider-only` modes without putting secrets in the hatch.

### D3 — Resolution is explicit and fail-closed

Credential selection precedence is:

1. an explicit, authorized dispatch override;
2. the node-owned workspace binding;
3. a node default only when exactly one eligible credential exists;
4. refusal.

Current working directory, last login, last used account, provider model default, and generic
environment variables are not selectors. With two eligible Copilot credentials and no binding,
resolution returns `model_credential_ambiguous` with safe candidate aliases.

An environment token is a visible, one-dispatch `source: env` override only. It is never imported
silently into the account catalog and never wins invisibly over a workspace binding. Status and
handoffs must report that an override is active without printing it.

The resolver returns an immutable dispatch snapshot:

```json
{
  "workspaceId": "rcdc5",
  "provider": "github-copilot",
  "credentialId": "model-account:01JEXAMPLE9TK8Q5M6W3Z",
  "credentialAlias": "blue",
  "credentialRevision": "sha256:<metadata-and-secret-version>",
  "model": "<resolved-model-id>",
  "source": "workspace-binding"
}
```

The host resolves and injects only the selected secret for that dispatch. Guest code receives no
credential catalog and cannot choose another account.

### D4 — Login creates or updates an aliased credential identity, never a provider slot

Intended CLI grammar:

```text
refarm model login github-copilot --as blue
refarm model login github-copilot --as account-03
refarm model credential add kimi-api --as moonshot-1
refarm model credential list --json
refarm model bind --workspace rcdc5 --credential github-copilot/blue
refarm model credential rename github-copilot/blue client-x
refarm model current --workspace rcdc5 --json
```

`--as` accepts an operator-defined alias; Refarm assigns the opaque id on first creation. A later
rename changes only the alias. Before storage, Copilot login verifies the GitHub user through an
official identity API and records immutable subject, host, and display login separately. It must
not infer account purpose from the alias, email, or organization membership. Managed-user,
organization, and enterprise entitlements are separate observed metadata when available.

Refarm must register and own its GitHub OAuth application if it performs device authorization. It
must not copy pi's, VS Code's, GitHub CLI's, or any other client's OAuth identifier. Delegating an
initial experiment to the official Copilot CLI is acceptable only when Refarm still passes an
explicit account token/session and does not inherit whichever CLI user was last active.

Credential removal refuses while bindings still reference it unless `--force` is explicitly used;
the refusal lists affected workspace ids, never secret or account login values.

### D5 — Model availability and policy are credential-scoped

There is no single correct static Copilot model list. Account plan, enterprise policy, geography,
and rollout can change eligibility. The catalog key is therefore at least:

```text
(provider, credentialId, credentialRevision, policyRevision)
```

The Copilot adapter asks the supported runtime for the models available to the selected credential.
A disabled model is reported as an entitlement or policy result, not as a missing provider. Static
defaults are only bootstrap hints and may never override a credential-advertised catalog.

Kimi API begins with documented stable ids and records the actual model returned by upstream. A
requested/actual mismatch is an observation and, where safety or cost changes, a refusal rather than
a silent fallback.

### D6 — Copilot starts with an official-SDK compatibility spike

The spike runs the official SDK/CLI in multi-tenant `empty` mode with:

- one explicit credential per session and ambient credential discovery disabled;
- no built-in tools, MCP servers, filesystem access, or inherited workspace configuration;
- an isolated working directory;
- an explicit model from the selected account catalog;
- streaming, cancellation, usage, policy, and AI-credit-limit events captured;
- two concurrent sessions using different accounts.

It must answer one architectural question: can the SDK provide a bounded model turn while Refarm
remains owner of prompt construction, tool execution, consent, and the loop? If yes, a host-side
Copilot bridge may implement the model-provider interface. If the SDK necessarily owns the agent
loop, Copilot becomes an external agent-runtime capability with its own declared tools and consent;
it must not masquerade as a raw provider or nest an opaque loop inside Tractor's agent.

The undocumented `copilot_internal` transport remains a lab-only comparison fixture. Promoting it
would require an explicit, separately approved exception with maintenance, policy, and revocation
risk recorded.

### D7 — Kimi API lands before Kimi Code

`kimi-api` uses the documented OpenAI-compatible endpoint, a Kimi Open Platform key, explicit region,
and public API pricing. It gets provider-specific conformance fixtures because “OpenAI-compatible”
does not guarantee identical tool calls, streaming deltas, errors, or usage fields.

`kimi-coding` is a different future adapter. It cannot reuse a Kimi API key, membership entitlement,
or balance by implication. If its policy gate is later cleared, it will use the same multi-account
contract and report subscription credits plus five-hour/weekly windows rather than API-token cost.

### D8 — Subscription allowance is a budget axis, not zero-dollar pricing

Each model observation gains a pseudonymous `credential_id` plus product and billing mode. It does
not gain a human login. The ledger distinguishes:

- metered token input, cached input, and output;
- included allowance consumed;
- marginal monetary charge;
- quota/credit unit and reset window;
- provider-reported usage versus Refarm estimate;
- billing owner such as individual, organization, enterprise, or API account.

For Copilot, capture official SDK credit/usage values such as total nano-AIU when available. Preserve
legacy premium-request observations when an account reports them. For Kimi API, use verified model
rates from the versioned model catalog. For a future Kimi Code adapter, record both shared credits
and time-window limits.

The router may prefer included allowance only when the observation is fresh enough and the selected
workspace is authorized for that provider/account. Exhaustion never silently changes account,
provider, data boundary, or model. A fallback is a separate declared route decision.

### D9 — Account binding is also a data-egress policy

A workspace binding means both “use this credential identity” and “this workspace may send model
context to this product under its observed billing context.” A dispatch must not fall back to a
different credential identity merely because it is logged in, cheaper, or has remaining allowance.

The minimum policy fields are:

```json
{
  "allowedWorkspaces": ["rcdc5"],
  "allowedProviders": ["github-copilot"],
  "fallback": "refuse",
  "contentClass": ["restricted-a"]
}
```

Policy is checked before loading the secret and again before dispatch. Public status reports only
safe ids and the reason code.

## Migration and compatibility

Migration is additive and reversible:

1. Read legacy `oauthCredentials[provider]` and `modelApiKey` as an implicit
   `<provider>/default` credential.
2. Mark its identity `unverified` until the provider can verify it.
3. Write new logins only through namespaced model secrets and account descriptors.
4. Keep legacy readers during a measured dual-read period; never dual-write secret values.
5. Report ambiguous legacy plus named credentials instead of choosing one.
6. Remove flat fields only after migration inventory, rollback, and parity tests pass.

The existing `GITHUB_COPILOT_ACCESS_TOKEN` and future `MOONSHOT_API_KEY` remain explicit environment
inputs for automation, not durable multi-account storage. The current Copilot `gpt-4o` default is
retired when credential-scoped discovery is available.

## Implementation slices

Each slice is independently revertible and ends with `refarm agent finish` for its affected lane.

### S0 — Contract fixtures, no provider traffic

- define `model-account-contract:v1` types and pure resolver;
- define safe descriptor, secret reference, binding, revision, and refusal codes;
- add Silo `model` namespace fixtures without changing its protection claim;
- add migration readers for the flat token schema;
- expose redacted `credential list`, `bind`, and `current` JSON shapes.

Exit: two same-provider fixtures resolve deterministically per workspace; ambiguity refuses.

### S1 — Kimi Open Platform canary

- register `kimi-api` separately from `kimi-coding`;
- add credential collection under a named id;
- implement the documented OpenAI-compatible endpoint and conformance fixtures;
- add current models/rates with official sources to the catalog;
- capture actual model, token usage, errors, and workspace/account attribution.

Exit: a reversible, explicitly authorized workspace canary passes streaming, tool-call, cancellation,
usage, error, and redaction tests. No Kimi Code credential is accepted.

### S2 — Copilot SDK boundary spike

- register a Refarm-owned GitHub OAuth development application or use an explicitly approved
  official-CLI experiment;
- obtain and verify two named GitHub identities without persistence collisions;
- run the official SDK matrix in `empty` mode;
- decide and record `model provider bridge` or `external agent runtime` from evidence.

Exit: the decision includes transcripts of protocol shape, usage/policy signals, cancellation,
process isolation, and concurrent account separation, with secrets redacted.

### S3 — Copilot production adapter

- implement the chosen supported boundary;
- discover models per credential and policy revision;
- add AI-credit and legacy request accounting;
- bind at least two independently aliased Copilot canaries to different safe workspaces;
- lift `RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS` only after the full runtime path passes.

Exit: `refarm ask` works through the selected account, and the previously honest runtime refusal is
removed only for the supported implementation.

### S4 — Router and budget integration

- include credential eligibility, egress policy, allowance freshness, and billing owner in route
  candidates;
- emit an explainable route decision without account PII;
- make exhausted allowance or disabled policy a typed reason;
- prove that fallback cannot cross a workspace's account/data boundary.

Exit: the bench can explain model, provider, account alias, price/allowance, policy, and fallback
without reading a secret.

### S5 — Promotion and cleanup

- run parallel multi-account canaries and restart/revocation drills;
- document credential rotation and account offboarding;
- remove superseded flat readers after the announced compatibility window;
- consolidate remaining provider documentation into this design plus operational runbooks.

## Acceptance matrix

| Scenario | Required result |
| --- | --- |
| login alias `blue`, then `account-03` | both credentials remain independently usable |
| re-login `account-03` | `blue` secret and revision are unchanged |
| rename `blue` to `client-x` | opaque id, binding, secret and history are unchanged |
| workspace `rcdc5` | resolves its bound opaque credential id |
| workspace `refarm` | resolves its own binding without inspecting cwd |
| two accounts, no binding | `model_credential_ambiguous` refusal |
| parallel dispatch through two accounts | no token, catalog, policy, session, or usage crossover |
| generic environment token present | visible explicit override or refusal; never silent precedence |
| one account's policy disables model | typed policy/entitlement result, no cross-account fallback |
| account quota exhausted | typed budget result, no implicit provider/account switch |
| token revoked during session | selected dispatch fails and credential becomes unhealthy; sibling is untouched |
| logs/status/budget export | safe credential id only; no token, email, or GitHub login |
| runtime restart | bindings and credential entries recover without “last login wins” |
| Kimi Code key supplied to `kimi-api` | product mismatch refusal |
| Kimi returns a different model | requested and actual ids observed; unsafe mismatch refuses |

## Operator decisions that remain explicit

The design can be implemented before these are all answered, but promotion cannot:

1. Which upstream identity dimensions distinguish two entries for each provider: user, host,
   tenant, project, region, scopes, billing owner, or another provider-specific dimension? Aliases
   never answer this question; verified metadata does.
2. Will Refarm register its own GitHub OAuth application, or will the first spike delegate login to
   an official Copilot CLI installation? The production preference is a Refarm-owned application and
   explicit per-session credentials.
3. Which Kimi product is actually desired: Open Platform API, Kimi Code membership, or both? Only
   Open Platform is currently approved by this design.
4. Which workspaces and content classes may leave through each account/provider?
5. Should an unbound single account be selected automatically? This design allows it at node level,
   but recommends explicit workspace bindings for sensitive work.

## Documentation authority and consolidation

This document supersedes the account-storage and Copilot-transport decisions in
[`2026-07-30-provider-login-flows-design.md`](./2026-07-30-provider-login-flows-design.md). That
document remains authoritative for the generic device-code user experience and branded callback.

It refines D3 and the subscription-budget portion of D4 in
[`2026-08-04-router-decides-from-the-catalog-design.md`](./2026-08-04-router-decides-from-the-catalog-design.md).
The catalog-driven routing decisions elsewhere in that document remain authoritative.

[`../../model-provider-strata.md`](../../model-provider-strata.md) remains the short operational
taxonomy and points here for account-aware behavior. The workspace hatch and sovereign-auth designs
continue to own workspace lifecycle and device authorization; this document owns only the model
credential chosen after a workspace is known.

Future implementation notes, test evidence, and open questions belong here until they become an
operator runbook or an ADR for a landed irreversible decision. They must not create parallel
Copilot, Kimi, or multi-account specs.
