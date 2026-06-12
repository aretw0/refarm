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

## Current POC Readiness

| POC | Current Strength | Current Gap | Prize Readiness |
| --- | --- | --- | --- |
| Extension sandbox | Strong deterministic policy exercise: manifest validation, denied capability, fail-fast vs warn+continue, policy decision, task artifacts, pilot scorecard, scenario, evidence annex, risk/standards matrix, and runtime evidence pointer. | The synthetic sandbox report still does not execute real WASM; real execution remains a dedicated E2E validation path. | Medium-high. Strong demonstration packet, still synthetic but linked to real runtime evidence. |
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
- `consumer-evidence.json` for the governed note box, exposed through labels
  `consumer`, `vault`, and `claim-promotion`.
- `limits.md` reports for each POC, exposed through labels `limits`,
  `adoption`, and `claim-boundary`.
- `validations/poc-evidence-index.json`, a suite-level reader map that points
  each theme to scenario, annex, scorecard, risk, limits, and claim-promotion
  evidence.
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

6. `consumer-evidence.json`
   - Implemented for the governed note box.
   - Documents downstream selector queries for lab datasets, publication
     datasets, publication preflight, and consumer readiness.
   - Keeps the proposal claim precise: manifest-consumer-ready, not real vault
     integration.

7. `limits.md`
   - Implemented for all three POCs.
   - Non-goals, adoption risks, and when the model should not be used.
   - This is important because the external drafts are strongest when they show
     skepticism and operational restraint.

8. `poc-evidence-index.json`
   - Implemented at `validations/poc-evidence-index.json`.
   - Provides the suite-level reading order and claim-promotion pointers.
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
