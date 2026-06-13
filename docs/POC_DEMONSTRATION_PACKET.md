# POC Demonstration Packet

Status: source guidance for turning validation evidence into reader-ready
demonstration packets without moving proposal writing into Refarm.

## Purpose

The validation POCs already prove useful technical mechanisms. A demonstration
packet is the next layer above that evidence: it helps a writer, reviewer, lab,
or future consumer understand what was run, what changed, what was measured,
and which claims remain outside the proof.

This file deliberately stays generic. It does not contain submission wording,
private vault structure, or employer-specific claims.

## Readiness Bar

A POC is presentation-ready when a reader can answer eight questions from
checked-in evidence:

| Question | Required evidence |
| --- | --- |
| What operational problem is being tested? | `scenario.md` |
| What architecture or workflow is under test? | `annex.md` |
| What steps were executed? | POC test, generated reports, or manifest producer command |
| What artifacts were produced? | `task-artifacts.json` |
| What objective criteria decide pilot success? | `scorecard.json` |
| What numbers or events support the result? | Scorecard metrics, report counts, receipts, or runtime evidence |
| What should not be claimed yet? | `limits.md` and risk matrix gaps |
| How can another consumer navigate the evidence? | `poc-evidence-index.json` and artifact selectors |

The current Refarm POCs satisfy the evidence-navigation layer. The remaining
work is mostly presentation density: fewer generic statements, more measured
events, and one compact reader table per theme.

## Packet Shape

Each POC should expose this reader packet:

1. Scenario
   - one problem statement;
   - actors and decision points;
   - synthetic-data boundary.

2. Execution trace
   - command or test that produced the evidence;
   - ordered steps;
   - generated artifact list.

3. Results table
   - 3 to 5 objective criteria;
   - observed result for each criterion;
   - pass, watch, or fail gate.

4. Evidence map
   - claim;
   - primary artifact;
   - reader-facing explanation;
   - non-claim that must remain visible.

5. Adoption boundary
   - what a pilot may try next;
   - what requires external review;
   - what belongs to downstream tools instead of Refarm.

## Theme 1: Extension Governance

Extension evidence already present:

- synthetic manifest and capability policy exercise;
- denied-capability case;
- warn-and-continue versus fail-fast behavior;
- human-reviewable `policy-decision.json`;
- runtime evidence pointer for real WASM validation path.

Extension reader gap:

- one compact table that connects lifecycle step, expected event, observed
  artifact, and pilot gate;
- one short architecture diagram outside the generated evidence if a reader
  needs visual orientation;
- stronger wording only after the real runtime path is run in the target
  environment.

Extension metrics to expose:

| Metric | Source | Writing use |
| --- | --- | --- |
| denied capability count | `policy-decision.json` | show that policy decisions are explicit |
| isolated failure count | `sandbox-report.json` | show failure handling is observable |
| lifecycle events recorded | `sandbox-report.md` or JSON report | show setup, ingest, teardown traceability |
| linked runtime commands | `runtime-evidence.json` | show route to real execution validation |

Extension claim boundary:

- production plugin governance;
- complete isolation guarantees;
- real WASM execution inside the synthetic sandbox report;
- certification or compliance.

## Theme 2: Citizen Data Wallet

Wallet evidence already present:

- synthetic identity and request;
- purpose, scope, expiration, and justification;
- signed authorization receipt;
- selective presentation;
- tamper detection;
- revocation event;
- human-reviewable `consent-decision.json`.

Wallet reader gap:

- one before-and-after table for active versus revoked authorization;
- one journey table from request to presentation to revocation;
- clear distinction between authorization evidence and formal wallet
  interoperability.

Wallet metrics to expose:

| Metric | Source | Writing use |
| --- | --- | --- |
| requested attributes | `service-request.json` | show data minimization pressure |
| presented attributes | `selective-presentation.json` | show only authorized fields are shared |
| authorization validity state | `authorization-receipt.json` and `revocation-event.json` | show revocation changes usability |
| tamper check outcome | POC test output and audit trail | show integrity boundary |

Wallet claim boundary:

- LGPD compliance;
- W3C VC, OpenID4VP, OpenID4VCI, or EUDI conformance;
- production UX or accessibility readiness;
- public-service integration.

## Theme 3: Governed Note Box

Note-box evidence already present:

- synthetic note intake;
- metadata preservation;
- lab and publication snapshots;
- draft exclusion from publication;
- human review before publish;
- downstream consumer evidence through manifest selectors.

Note-box reader gap:

- one table from input note to metadata record to lab snapshot to publication
  preflight;
- one explicit consumer-readiness check that explains selectors without
  claiming real vault integration;
- real downstream validation in `vault-seed` when that repository is in scope.

Note-box metrics to expose:

| Metric | Source | Writing use |
| --- | --- | --- |
| intake note count | `intake-snapshot.json` | show controlled input set |
| metadata fields preserved | `metadata-index.json` | show traceability |
| drafts excluded | `publication-snapshot.json` | show publication hygiene |
| human-review gate | `publication-preflight.json` | show governance before publication |
| selector coverage | `consumer-evidence.json` | show downstream navigation readiness |

Note-box claim boundary:

- real vault integration;
- complete publication workflow;
- ownership of Obsidian, Astro, Marimo, or work-mirror UX by Refarm;
- editorial policy completeness.

## What Refarm Should Own

Refarm should keep owning portable primitives:

- task artifact manifests;
- evidence indexes;
- claim boundaries;
- deterministic synthetic fixtures;
- consumer selectors;
- source-level validation commands;
- environment and platform gates.

These primitives help Refarm itself and future second or third consumers use
the same evidence without copying a private proposal workflow.

## What Consumer Suites Should Own

Consumer suites should keep owning their product surface:

- proposal wording;
- vault-local MOCs and publication flow;
- visual assets and slide decks;
- institutional metrics and cost estimates;
- real external integrations;
- domain-specific review.

That boundary keeps Refarm useful as a daily-driver substrate while letting
writing vaults, labs, and future CLIs compose it for their own audience.

## Next Slices

1. Add generated `results-table` artifacts for each POC when the next POC logic
   change happens.
2. Let `poc-evidence-index.json` point to those tables after they exist.
3. Keep `pnpm run validation-pocs:test` as the canonical local gate.
4. Promote only claims backed by repeatable commands or checked-in artifacts.
