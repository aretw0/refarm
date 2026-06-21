# POC Prize Readiness

Status: local validation note for keeping Refarm POCs useful as product pressure
without copying or writing into external proposal vaults.

## Short Answer

The validation POCs are technically useful, but they are not yet as rich as a
submission-ready prize demonstration.

They already provide deterministic evidence, synthetic data, review artifacts,
task artifact manifests, pilot scorecards, scenario narratives, evidence
annexes, and careful risk/standards matrices. That is the right foundation.
What is still thinner than a winning-style work is the final presentation layer:
polished diagrams, submission-specific framing, real integration evidence, and
reader-facing synthesis outside the validation repository.

## Calibration Source

Read-only calibration from the external writing vault showed that the work
drafts emphasize:

- problem framing tied to public-sector risk and value;
- related work and alternatives;
- incremental adoption plans with phase gates;
- objective metrics and thresholds for pilot continuation;
- explicit criteria for when not to adopt the proposed model;
- annex and diagram planning for reader comprehension;
- quality reports over the writing itself.

That bar is broader than "the POC runs." A prize-facing POC must let a reviewer
see the claim, run or inspect the evidence, understand limits, and map the
result to operational value.

## Benchmark Transfer Pattern

Read-only calibration against the prior winning-style benchmark suggests that a
strong proposal does not hide the POC until the end, but also does not lead with
raw demo artifacts. The useful structure is a narrative ladder:

1. concrete institutional context;
2. quantified problem;
3. general objective and specific objectives;
4. architecture and method;
5. POC with verifiable steps;
6. limits, risks, and mitigations;
7. expected institutional impact.

For Refarm evidence, the transfer should happen at the level of argumentative
function, not wording. The POCs should appear early as the controlled validation
method, then the full artifact map should appear only after the reader
understands the problem, operating model, and adoption boundary.

The writing-safe rule is:

- mention the POC early as a method;
- explain architecture before result tables;
- present generated artifacts as evidence, not as product marketing;
- keep non-claims visible near every stronger claim;
- keep prize wording, institutional estimates, and private draft language
  outside this repository.

## Proposal Evidence Matrix

Use this matrix as the minimum bar before external writing turns a POC into a
claim. Each row should be defensible from a generated artifact, a validation
command, or a public reference owned outside this repository.

| Theme | Problem | Architectural decision | POC evidence | Observable metric | Current limit |
| --- | --- | --- | --- | --- | --- |
| Extension sandbox | Extension and coding-agent ecosystems need reviewable capability boundaries before promotion. | Manifest + policy decision + lifecycle evidence + human promotion gate before install, tool use, or stronger autonomy. | `policy-decision.json`, `sandbox-report.json`, `runtime-evidence.json`, `coding-agent-evidence.json`, `coding-agent-smoke.json`, `coding-agent-temp-workspace.json`, `task-artifacts.json`. | denied capabilities counted; isolated failures counted; policy mode recorded; coding-agent capability boundary recorded; proposal-only smoke recorded; temporary-workspace rehearsal recorded; artifact hashes present. | Synthetic policy POC; real WASM/runtime and real model-driven coding-agent execution paths remain separate evidence. |
| Citizen data wallet | Personal data sharing needs purpose, scope, expiration, revocation, and auditability. | Authorization receipt + selective presentation + revocation event + consent decision. | `service-request.json`, `authorization-receipt.json`, `selective-presentation.json`, `revocation-event.json`, `consent-decision.json`. | requested vs disclosed attributes; receipt integrity check; revocation status; review state. | No formal wallet, legal, UX, or standards conformance claim. |
| Governed note box | Knowledge workflows need provenance from intake through lab/publication without publishing drafts by accident. | Metadata index + lab snapshot + publication snapshot + human-review preflight. | `metadata-index.json`, `lab-snapshot.json`, `publication-snapshot.json`, `publication-preflight.json`, `consumer-evidence.json`. | source count; publishable vs draft count; review gate status; manifest selector coverage. | Synthetic workflow; vault UX and publication remain consumer-owned, especially in `vault-seed`. |

This matrix is the practical definition of "POC rich enough for writing": a
claim is mature only when the reader can see why the problem matters, which
technical decision addresses it, which artifact proves the mechanism, which
metric would gate a pilot, and which boundary prevents overclaiming.

## Current POC Readiness

| POC | Current Strength | Current Gap | Prize Readiness |
| --- | --- | --- | --- |
| Extension sandbox | Strong deterministic policy exercise: manifest validation, denied capability, fail-fast vs warn+continue, policy decision, task artifacts, pilot scorecard, scenario, evidence annex, risk/standards matrix, runtime evidence pointer, coding-agent governance packet, proposal-only coding-agent smoke, and temporary-workspace rehearsal. | The synthetic sandbox report still does not execute real WASM or a real model-driven coding-agent patch loop; those remain dedicated validation paths. | Medium-high. Strong demonstration packet, still synthetic but linked to real runtime evidence and now easier to present as a governed coding-agent scenario. |
| Citizen data wallet | Strong consent artifact: purpose, scope, expiration, selective disclosure, revocation, tamper check, audit trail, task artifacts, pilot scorecard, scenario, evidence annex, and risk/standards matrix. | It lacks UX/accessibility review, legal review, and standards test-suite evidence for any formal compliance claim. | Medium-high. The evidence is coherent; public-service journey polish remains external. |
| Governed note box | Strong local knowledge workflow: intake, metadata, graph/lab snapshot, publication snapshot, human review, task artifacts, pilot scorecard, scenario, evidence annex, risk/standards matrix, and consumer evidence. | It is intentionally synthetic and not yet consumed by a real vault-seed-style lab/export/publication project or real vault quality gates. | Medium-high. Good contract pressure for Refarm and credible Theme 3 input, still synthetic. |

## What Is Already a Reusable Primitive

- `refarm.task-artifacts.v1` style manifests for generated reports, datasets,
  receipts, logs, and review artifacts.
- Deterministic synthetic fixtures that avoid personal, institutional, and
  secret data.
- Decision artifacts such as consent and policy decisions that summarize the
  review point without forcing readers to inspect every raw output.
- `scorecard.json` reports with pilot metrics, weights, thresholds, gates, and
  explicit limits, exposed through task artifact manifests as `report` artifacts
  labeled `scorecard` and `pilot`.
- `scenario.md` and `annex.md` reports for each POC, exposed through labels
  `scenario`, `reader-path`, `annex`, and `evidence-map`.
- `risk-and-standards-matrix.json` reports for each POC, exposed through labels
  `risk`, `standards`, and `claim-promotion`.
- `runtime-evidence.json` for the extension sandbox, exposed through labels
  `runtime`, `wasm`, and `claim-promotion`.
- `coding-agent-evidence.json` for the extension sandbox, exposed through labels
  `coding-agent`, `agent-governance`, `claim-promotion`, and `theme-1`.
- `coding-agent-smoke.json` for the extension sandbox, exposed through labels
  `coding-agent`, `smoke`, `review-packet`, `denied-capability`,
  `claim-promotion`, and `theme-1`.
- `coding-agent-temp-workspace.json` for the extension sandbox, exposed through
  labels `coding-agent`, `temporary-workspace`, `review-packet`,
  `denied-capability`, `claim-promotion`, and `theme-1`.
- `consumer-evidence.json` for the governed note box, exposed through labels
  `consumer`, `vault`, and `claim-promotion`.
- `limits.md` reports for each POC, exposed through labels `limits`,
  `adoption`, and `claim-boundary`.
- `validations/poc-evidence-index.json`, a suite-level reader map that points
  each theme to scenario, annex, scorecard, risk, limits, and claim-promotion
  evidence, plus sanitized `writingClaims` that map careful proposal claims to
  primary evidence and explicit non-claims.
- Consumer-oriented provenance: producer command, source path, hashes, media
  type, review state, and intended consumer labels.
- Focused validation lane: `pnpm run validation-pocs:test`.

These are ecosystem primitives because they help Refarm, labs, docs, and future
external consumers exchange evidence without sharing private vault semantics.

## What Still Belongs to Consumer Suites

- Prize-specific wording, theme naming, and submission framing.
- Real vault structure, PARA conventions, Obsidian/Astro/Marimo publishing
  choices, and work-mirror constraints.
- Institution-specific metrics, policy language, and annex formatting.
- Any content copied from read-only job vaults.

Refarm should expose the evidence contract and repeatable validation pressure.
The writing vault and vault-seed should own the actual submission packaging.

## Minimum Upgrade to Become Presentation-Rich

Each POC should grow one lightweight "demonstration packet":

1. `scenario.md`
   - Implemented for all three POCs.
   - Public-sector problem statement.
   - Actors and decision points.
   - What the POC proves and what it explicitly does not prove.

2. `scorecard.json`
   - Implemented for all three POCs.
   - Pilot metrics, target thresholds, current synthetic result, readiness gate,
     and explicit limits.

3. `annex.md`
   - Implemented for all three POCs.
   - One reader-friendly diagram or table.
   - Mapping from generated artifacts to proposal claims.
   - No Refarm product naming when intended for external proposal reuse.

4. `risk-and-standards-matrix.json`
   - Implemented for all three POCs.
   - Controls, risks, alignment stance, gaps, and `conformanceClaim: false`.
   - Evidence for careful standards discussion without claiming certification.

5. `runtime-evidence.json`
   - Implemented for the extension sandbox.
   - Links the synthetic policy POC to real WASM build and browser lifecycle
     validation commands.
   - Keeps the proposal claim precise: linked validation path, not production
     governance.

6. `coding-agent-evidence.json`
   - Implemented for the extension sandbox.
   - Frames Theme 1 as a controlled coding-agent workflow with explicit
     capability review, provenance, and human promotion gates.
   - Keeps the proposal claim precise: governance shape, not production
     autonomous coding.

7. `coding-agent-smoke.json`
   - Implemented for the extension sandbox.
   - Records a proposed patch, review packet, denied-capability receipt, and
     protected-surface non-mutation as deterministic smoke evidence.
   - Keeps the proposal claim precise: packet shape, not real model-driven
     patch generation.

8. `coding-agent-temp-workspace.json`
   - Implemented for the extension sandbox.
   - Rehearses the proposed patch against a temporary workspace copy while
     repository promotion remains blocked on review.
   - Keeps the proposal claim precise: isolated rehearsal, not complete
     repository sandboxing or unattended promotion.

9. `consumer-evidence.json`
   - Implemented for the governed note box.
   - Documents downstream selector queries for lab datasets, publication
     datasets, publication preflight, and consumer readiness.
   - Keeps the proposal claim precise: manifest-consumer-ready, not real vault
     integration.

10. `limits.md`
   - Implemented for all three POCs.
   - Non-goals, adoption risks, and when the model should not be used.
   - This is important because the external drafts are strongest when they show
     skepticism and operational restraint.

11. `poc-evidence-index.json`
   - Implemented at `validations/poc-evidence-index.json`.
   - Provides the suite-level reading order and claim-promotion pointers.
   - Carries `writingClaims` so downstream tools can navigate from careful
     claim to primary evidence and language boundary.
   - Keeps consumer navigation generic instead of embedding vault or proposal
     semantics in Refarm.

## Recommended Next Slices

1. Run the dedicated real WASM/browser lifecycle E2E in target environments
   before using stronger real-execution wording.
2. Let a downstream writing or vault project read
   `validations/poc-evidence-index.json`, then select `limits.md` from each
   manifest before converting evidence into proposal text.
3. Let vault-seed consume those manifests later, instead of moving vault UX into
   Refarm.

This keeps Refarm on the right side of the boundary: it becomes the source of
portable evidence primitives, while the prize vault remains the writing and
submission surface.

For a writer-facing map of which generated artifacts support which sanitized
claims, see [POC Writing Handoff](POC_WRITING_HANDOFF.md).
