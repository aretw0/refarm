# The router decides from the catalog

Date: 2026-08-04
Status: DESIGN. The findings are measured, the operator approved the lane after seeing them.
Awaits an implementation plan.
Touches `packages/agent/**`, `packages/model-catalog-v1/**`, `packages/config/**`, `packages/tractor/src/host/**`.
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md)

## What forced this

The operator named three things he wants: an orchestrator that picks the right model, idle
GitHub Copilot quota put to work, and the bench the permanent budget laboratory needs. They read
like three projects. They are one, and the seam they share is what the router is allowed to know
when it decides.

Today `resolve_profile` (`packages/agent/src/provider_config.rs`) walks a hand-written candidate
list per profile and filters it by `ModelCapabilities`, whose `cost_tier` is a four-value enum
assigned **per provider**.

The tier is not wrong. Sorted against the rates now verified in the catalog, the hand assignment
comes out in exact order, with no inversion:

| provider | default model | input $/MTok | output $/MTok | assigned tier |
| --- | --- | ---: | ---: | --- |
| deepseek | deepseek-v4-flash | 0.14 | 0.28 | Cheap |
| gemini | gemini-3-flash-preview | 0.50 | 3.00 | Cheap |
| groq | llama-3.3-70b-versatile | 0.59 | 0.79 | Cheap |
| xai | grok-4.3 | 1.25 | 2.50 | Mid |
| mistral | mistral-medium-3-5 | 1.50 | 7.50 | Mid |
| anthropic | claude-sonnet-5 | 3.00 | 15.00 | Premium |
| openai | gpt-5.6-sol | 5.00 | 30.00 | Premium |

The defect is not accuracy. It is resolution. Because the tier belongs to a provider rather than a
model, **the cheapest model available is unreachable**:

| model | input | output | reachable by the `cheap` profile? |
| --- | ---: | ---: | --- |
| gpt-5-nano | 0.05 | 0.40 | no, `openai` is Premium |
| gpt-4o-mini | 0.15 | 0.60 | no |
| gpt-5.6-luna | 0.20 | 1.20 | no |
| deepseek-v4-flash | 0.14 | 0.28 | yes |

`gpt-5-nano` is cheaper on both axes than everything the `cheap` profile can select. The router
cannot see it, and no amount of correcting the tiers would help, because a per-provider value
cannot express a per-model fact.

The same coarseness blocks the other two goals for the same reason:

- **Idle quota.** "Free while the quota lasts" is a cost that changes over time. A static enum
  cannot express it at all, so Copilot cannot be routed to on the grounds that make it worth
  routing to.
- **The bench.** Comparing routes requires the reason for a choice to be data. Today the reason is
  `CostTier::Premium`, which compares against nothing.

## What already exists, measured today

- `packages/model-catalog-v1/catalog/model-rates.v1.json`: 27 entries, every rate carrying its
  vendor page and the date it was checked, 13 with a verified context window carrying its own
  separate source and date, time-varying rates expressed through `effectiveFrom`/`effectiveTo`.
- A validator that refuses an entry made unreachable by a preceding, less specific `contains` rule,
  which is the bug that once billed Opus 4.5 at Opus 4's rate.
- A superset test stating when `rate_for_model` may be retired: when the catalog prices every id
  the Rust table prices.
- Observations already stamp `rate_table_version` and, since `fd7d8b49`, a real `elapsed_ms`.
- The guest already depends on `serde_json`.
- GitHub Copilot is half present: classified as `subscription` in `utils.rs`, documented as
  `GITHUB_COPILOT_ACCESS_TOKEN`, given a default model of `gpt-4o` in `defaultModelForProvider`.
  It has **no base URL** in `openai_compat_defaults`, so no Rust route exists, and
  `RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS` lists only `openai-codex`, so the runtime refuses it.

## The design

### D1. The catalog reaches the guest by injection, not by embedding

The host already forwards a screened set of `MODEL_*` environment values to the guest, gated by
`is_forwardable_model_env_pair` and `is_disallowed_model_forward_env_upper`
(`packages/tractor/src/host/sensitive_aliases.rs`), and the guest reads them with `std::env::var`.
`MODEL_CONFIGURED_PROVIDERS` already travels that way, carrying a non-secret list the guest could
not otherwise learn. The catalog is the same shape of fact.

**Decision: the host injects the catalog through that existing seam.** The alternative, embedding
the JSON with `include_str!`, is simpler and was rejected for one reason: a rate correction would
then require rebuilding and redeploying a WASM component. The entire provenance apparatus built on
2026-08-03 and 2026-08-04 exists so that a wrong rate can be found and fixed; making the fix cost a
component rebuild would put the slowest possible step in the path of the thing most likely to need
changing.

Measured payload: the full catalog is 7,951 bytes compact; the projection a router actually needs,
provider plus match value plus the two rates, is 1,453 bytes. Neither is a size problem for an
environment value the host constructs directly.

The guest must treat an absent or malformed catalog as absent, never as empty. A catalog that fails
to parse means the router does not know prices, which is not the same as everything being free, and
the D6 rule this repository already enforces on observations applies unchanged here.

### D2. The tier is derived from the rate, not assigned to the provider

`ModelCapabilities.cost_tier` stops being a hand-written constant per provider and becomes a
function of the model's verified rate. `provider_capabilities` keeps `tool_call` and
`structured_json`, which are genuine capability facts a price cannot express, and loses the field
that was standing in for data it now has.

This is deliberately the same move as deleting `context_window` from the same struct on 2026-08-04.
That field was an uncited number nothing read; this one is a cited-by-nothing number that something
does read. The remedy is identical: the fact belongs where the schema forces a source and a date.

What changes observably: a `cheap` profile can select `gpt-5-nano`, and the audit event
`agent:route:selected` can record the rate that justified the choice instead of a tier name.

### D3. Copilot becomes a real route, with personal and corporate as distinct credentials

Two concrete pieces are missing and they are separable:

1. A base URL in `openai_compat_defaults` plus `github-copilot` in
   `RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS`, which is what makes the route exist at all.
2. A GitHub OAuth device flow, which is what makes it usable without pasting a token.

The operator holds two accounts, personal and corporate, and refarm sits at the intersection of
both. They are two credentials for one provider, not two providers, which is a distinction the
credential layer must carry rather than the routing layer.

### D4. Quota is the fourth budget axis, and it refills

`BudgetDeclaration`'s fields are all optional, so a fourth axis is additive rather than a version
bump. It differs from the three that exist in one way that matters: deadline, tokens and spend are
all consumed monotonically within a run, while a quota is a bucket that refills on the vendor's
billing period. A ceiling that refills is not a smaller version of a ceiling that does not, and the
resolver should not pretend otherwise.

This slice is deliberately placed after D3. Writing an axis for a provider that cannot yet be
routed to would be the written-correct-and-unreachable shape this repository has now catalogued six
times.

### D5. The bench

With a verified per-model cost, a real `elapsed_ms`, and a recorded reason for each route, comparing
two routes on the same work becomes measurement. This is the thing the permanent laboratory was
built to make possible, and it is last because every earlier slice is one of its inputs.

## What this deliberately does not do

**It does not build an orchestrator plugin.** The operator described one, and what he described is
what D1 and D2 produce: a router that can see what the catalog knows. Adding a plugin boundary
before that exists would be drawing a seam around behaviour that has not been written yet.

**It does not retire `rate_for_model` in D1.** The superset test in
`packages/model-catalog-v1/src/index.test.ts` states the condition for retiring it, and that
condition is now met, but retiring it is a separate, verifiable step from teaching the router to
read the catalog. Doing both at once would leave no green state in between.

## Open questions

- **Which projection does the guest receive?** The full catalog carries context windows and
  effective windows the router may not need on day one. Sending everything is simpler and 8 KB;
  sending a projection is 1.5 KB and creates a second shape to keep in step with the first.
- **How does an effective window resolve inside the guest?** `resolveModelTariffEntry` takes an
  `at` date and defaults to today. The guest's access to a clock is through WASI, and
  `rate_for_model` is pure today. Making pricing time dependent changes that, and the introductory
  Sonnet 5 window expiring on 2026-08-31 is a real case, not a hypothetical.
- **Does a derived tier keep four names?** Local, Cheap, Mid and Premium are boundaries someone
  chose. Derived from a continuous price they become thresholds, and thresholds want a stated
  reason the same way the rates do.
