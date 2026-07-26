# vault-seed → refarm — assimilation inventory (SDK-first)

> 2026-07-26. Answers the operator's "avaliar o que mais podemos assimilar dele (~/github/vault-seed)".
> refarm is the authority where everything **generic** is cultivated as an **SDK primitive**; vault-seed
> (the DGK) keeps only the thin product layer. Assimilate generic capabilities up as importable blocks —
> **not** app-coupled features (see the SDK-first guardrail). Sourced from vault-seed's own
> `docs/convergencia-refarm-feedback.md` (the real consumer's voice) + a scope survey.

## Already done this session

- **`@refarm.dev/dispatch-surface` consumer-pull wording — corrected (commit `44bf0f01`).** The consumer
  nearly modeled its CLI dispatch on it because the proofTarget said "product commands"; the real API is
  channel/transport dispatch. Fixed the description so SDK consumers adopt it correctly.
  *Still open (relay):* consider reclassifying `dispatch-surface`/`effort-contract` as **vendor-only /
  runtime** rather than a vault-seed *consumption* target — but that changes the selection/handoff, so
  weigh it against the now-verified 43/43 convergence before touching it.

## Candidates (assess-then-assimilate, priority order)

1. **YAML-LD codec — HIGH, the cleanest SDK primitive.** vault-seed's feedback: "o codec (parse/serialize,
   preserve-unknown, forward-safe) é **genérico**". A pure, side-effect-free codec is an ideal importable
   block, and it sits on the `records:v1` / `refarm.dev/contexts/records/v1` axis refarm already owns.
   *Next:* locate it (referenced from `scripts/generate_records_data.mjs`), check its deps are closed,
   extract into a refarm block (e.g. `@refarm.dev/yaml-ld` or fold into a records/codec package), add a
   consumer contract test, and add it to the `vault-seed-ready` handoff. Product vocab/schema stays downstream.

2. **quality:v1 Python checkers — MEDIUM.** The `quality:v1` *contract* is already assimilated, but the
   checker *story* is not: pt-text (accent drift) + `avaliar_textos.py` / `avaliar_apresentacoes.py`
   (`packages/cli/vendor/quality/`) are generic prose/presentation checkers. Generic = the rule engine,
   severity, and `quality:v1` envelope; downstream = rubrics, weights, rule catalog, copy. More involved
   (Python + CLI). **It is quality, not health** — keep the capabilities distinct.

3. **`@aretw0/dgk-channels` (rate limiter + contact topology) — MEDIUM, needs scoping.** Self-described
   "platform-agnostic rate limiter and contact topology for publishing pipelines" — sounds like a clean
   generic primitive, but its exports weren't legible in this survey. *Next:* read its API; if it's a
   pure rate-limiter/topology lib, it's an SDK block; if it's welded to dgk's publishing product, leave it.

## Non-candidate (already covered)

- **`@aretw0/dgk-runner`** — it is **9 lines**: `export const run = createProcessHandoffRunner()` from
  `@refarm.dev/process-handoff`. refarm already provides the runner engine; the package is a trivial
  default wrapper. *Action:* the stale comment "Replace with `@refarm.dev/dgk-runner` when the refarm
  engine is available" should be updated in vault-seed — the engine (`createProcessHandoffRunner`) is
  already available and consumed.

## SDK-first guardrail (applies to every item above)

Each assimilation ships as an **importable SDK primitive**, decoupled — never an app feature by
consequence. The product boundary (labels, vocab, routes, rubrics, copy, UX) stays downstream in
vault-seed. Order: finish vault-seed + refarm for the creator first; external consumers (the doceria)
come after. See the `sdk-first-not-app-coupled` and `vault-seed-refarm-dogfood` memories.
