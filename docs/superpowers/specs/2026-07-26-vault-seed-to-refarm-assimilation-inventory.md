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

## Candidates — VERIFIED (assessed each; the field is largely already planted)

The headline, after reading the actual code: **the big generic capabilities are already assimilated**
(records, ds, health, quality-contract, local-surface, enrichment, content-projection, source-web,
ds-astro, process-handoff, channel-policy — all refarm SDK blocks, all consumer-proven). What remains
in vault-seed is trivial, product-coupled, or a Python/rubric story. **That is the ocamento succeeding**
— vault-seed is now genuinely a thin product layer on refarm's SDK.

1. **YAML-LD codec — ALREADY DONE (not a candidate).** Refarm implements it as
   `@refarm.dev/records-contract-v1/yaml` (`recordFromYamlLdObject`, `recordToYamlLdObject`,
   `parseRecordsYamlLdFrontMatter`, …), spec `specs/features/2026-06-30-records-yaml-ld-codec-candidate.md`
   ("IMPLEMENTED CANDIDATE, second-consumer proof closed in vault-seed"). vault-seed consumes the contract
   for stamping/validation (`buildRecordsFromNotes` → `computeRecordContentHash`, `createReferenceRecordsProvider`);
   its `noteToRecord` is legitimately **product** projection (folder→@type, wikilinks→relations, PARA) that
   the spec keeps downstream. records consumer contract is green (part of 43/43). The earlier "HIGH candidate"
   here was stale feedback from before the 2nd-consumer proof.

2. **quality:v1 Python checkers — deferred, not a clean SDK plant.** The `quality:v1` *contract* is already
   assimilated. The checkers (`pt-text`, `avaliar_textos.py`/`avaliar_apresentacoes.py`) are Python + carry
   vault-specific rubrics/weights/copy — the generic part (a rule-runner emitting `quality:v1`) is thin and
   speculative, and a Python capability is a bigger, cross-language effort. Leave until there's real second
   pressure for a generic quality-rule-runner.

3. **`@aretw0/dgk-channels` — NOT a clean primitive (product-coupled).** Read its API: `rate_limiter.js`
   hardcodes `~/.dgk` state path + `PLATFORM_LIMITS`; `contacts.js` is vault/telegram-coupled
   (`resolveContactsDir(vaultRoot)`, `CONTACTS_LOCATION_VAULT`, `telegramChatsToContacts`). A generic pure
   rate-limiter core *could* be carved out, but it's welded to dgk/vault/telegram and the SDK value is
   speculative. Leave unless a second, non-vault consumer needs a generic rate limiter.

- **`@aretw0/dgk-runner` — non-candidate (already covered).** 9 lines: `export const run =
  createProcessHandoffRunner()` from `@refarm.dev/process-handoff`. refarm already provides the engine.
  *Action:* update vault-seed's stale "Replace with `@refarm.dev/dgk-runner` when available" comment — it's
  already available and consumed.

## Bottom line for assimilation

**No clean, high-value generic capability remains ready to plant** — the ocamento is largely complete.
The honest next moves are consumer-side polish (drop vault-seed's stale stand-in comments; the dispatch-surface
wording is already fixed), not new refarm blocks. Re-open only when a *second* consumer creates real pressure
for one of the deferred items (a generic quality-rule-runner, a platform-agnostic rate limiter). This is the
SDK-first model working as intended: refarm owns the generic, vault-seed keeps the thin product.

## SDK-first guardrail (applies to every item above)

Each assimilation ships as an **importable SDK primitive**, decoupled — never an app feature by
consequence. The product boundary (labels, vocab, routes, rubrics, copy, UX) stays downstream in
vault-seed. Order: finish vault-seed + refarm for the creator first; external consumers (the doceria)
come after. See the `sdk-first-not-app-coupled` and `vault-seed-refarm-dogfood` memories.
