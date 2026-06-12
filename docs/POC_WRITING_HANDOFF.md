# POC Writing Handoff

Status: sanitized handoff for continuing proposal writing outside this
repository. This is not submission text and should not be copied as-is.

## Boundary

- Do not write from Refarm into external proposal vaults.
- Do not cite Refarm product names when the target writing cannot name this
  repository.
- Treat generated artefacts as evidence for writing, not as final annexes.
- Keep standards claims careful: these POCs show design pressure and validation
  shape, not formal conformance.

## Claim Promotion Rule

The non-claims below are not permanent exclusions. They are the current honesty
boundary for proposal writing. Promote one only when a repeatable command,
fixture, manifest, or external conformance check proves it.

| Claim class | Promote when | Current writing stance |
| --- | --- | --- |
| Real execution | A CI command exercises the real runtime path, not only synthetic fixtures. | Can cite as adjacent evidence only when the validation is linked directly. |
| Product governance | A policy contract, lifecycle command, and regression test cover install, deny, quarantine, and review. | Describe as governance model pressure, not production governance. |
| Standards alignment | A standards matrix maps clauses to artefacts and records gaps. | Say "inspired by" or "compatible direction", not "conformant". |
| Legal or institutional compliance | A qualified compliance review exists outside the POC. | Say the POC makes reviewable evidence explicit. |
| Production UX or accessibility | A UI surface exists and is checked with accessibility and cross-platform tests. | Say the data flow is validated, not the final experience. |
| Vault integration | A consumer project reads the manifest without copying Refarm internals. | Say the artefacts are ready for downstream consumption. |

Near-term promotion should favor claims that strengthen all consumers:

1. Link the extension sandbox to the existing real WASM validation before
   claiming real plugin execution for Theme 1.
2. Expand standards matrices into dedicated conformance suites only when a
   formal claim is actually needed.
3. Keep vault, notebook, and publication UX in consumer projects; promote only
   shared manifest, provenance, scoring, and preflight primitives back into
   Refarm.

## Validation Command

```bash
pnpm run validation-pocs:test
```

This command runs all three synthetic POCs, validates every
`refarm.task-artefacts.v1` manifest, and verifies consumer selection through
`@refarm.dev/artefact-contract-v1`.

## Theme 1 Evidence: Extension Sandbox

Extension artefact root:

```text
validations/extension-sandbox-poc/fixtures/expected/
```

Extension files:

| File | Use in writing | What it proves |
| --- | --- | --- |
| `scenario.md` | Explain the operational problem and actors. | Extension governance can be framed as host, operator, and extension decisions. |
| `annex.md` | Build a readable evidence map or flow table. | Manifest, capability, lifecycle, failure mode, and pilot gate are connected. |
| `sandbox-report.json` | Support technical detail. | Synthetic plugin-policy combinations are evaluated deterministically. |
| `policy-decision.json` | Support governance and review claims. | Denied capabilities and isolated failures are reviewable. |
| `scorecard.json` | Support pilot continuation criteria. | The POC has weighted metrics, thresholds, gate, and limits. |
| `risk-and-standards-matrix.json` | Support careful standards and risk discussion. | Alignment, controls, and gaps are explicit without claiming conformance. |
| `runtime-evidence.json` | Support careful real-WASM discussion. | The synthetic sandbox is linked to a dedicated real WASM validation path. |
| `task-artefacts.json` | Support provenance claims. | Artefacts have hashes, media types, producer command, and review state. |

Extension non-claims:

- real WebAssembly execution inside the synthetic sandbox report;
- production plugin governance;
- full security certification;
- performance of a real plugin host.

## Theme 2 Evidence: Citizen Data Wallet

Wallet artefact root:

```text
validations/citizen-data-wallet-poc/fixtures/expected/
```

Wallet files:

| File | Use in writing | What it proves |
| --- | --- | --- |
| `scenario.md` | Explain the service journey and actors. | Purpose, scope, presentation, revocation, and review can be represented. |
| `annex.md` | Build a reader path from request to revocation. | Each claim maps to generated evidence. |
| `service-request.json` | Support purpose and minimization claims. | Request purpose, expiration, and requested attributes are explicit. |
| `authorization-receipt.json` | Support integrity claims. | Authorization is signed over a canonical payload. |
| `selective-presentation.json` | Support selective disclosure claims. | Only requested attributes are presented. |
| `revocation-event.json` | Support revocation claims. | The authorization moves from active to revoked. |
| `consent-decision.json` | Support human-review claims. | Purpose, scope, disclosure, revocation, and review status are summarized. |
| `scorecard.json` | Support pilot continuation criteria. | The POC has weighted metrics, thresholds, gate, and limits. |
| `risk-and-standards-matrix.json` | Support careful standards, privacy, and risk discussion. | Alignment, controls, and gaps are explicit without claiming conformance. |
| `task-artefacts.json` | Support provenance claims. | Artefacts have hashes, media types, producer command, and review state. |

Wallet non-claims:

- EUDI wallet interoperability;
- W3C VC or OpenID4VP/OpenID4VCI conformance;
- LGPD compliance;
- production UX or accessibility readiness.

## Theme 3 Evidence: Governed Note Box

Note-box artefact root:

```text
validations/governed-note-box-poc/fixtures/expected/
```

Knowledge workflow files:

| File | Use in writing | What it proves |
| --- | --- | --- |
| `scenario.md` | Explain the local knowledge workflow. | Intake, lab, publication, and review can be separated. |
| `annex.md` | Build a reader path from note intake to publication preflight. | Each workflow claim maps to generated evidence. |
| `intake-snapshot.json` | Support ingestion claims. | Synthetic source notes are captured. |
| `metadata-index.json` | Support traceability claims. | Notes retain tags, links, status, dates, and body hashes. |
| `lab-snapshot.json` | Support analysis/lab claims. | Metrics and graph data are available without publishing drafts. |
| `publication-snapshot.json` | Support publication hygiene claims. | Only ready notes are selected. |
| `publication-preflight.json` | Support governance claims. | Human review is required before publishing. |
| `scorecard.json` | Support pilot continuation criteria. | The POC has weighted metrics, thresholds, gate, and limits. |
| `risk-and-standards-matrix.json` | Support careful workflow governance and risk discussion. | Alignment, controls, and gaps are explicit without claiming conformance. |
| `consumer-evidence.json` | Support downstream/vault-seed-style consumer readiness. | Manifest selectors, labels, roles, and limits are explicit without claiming real vault integration. |
| `task-artefacts.json` | Support provenance claims. | Artefacts have hashes, media types, producer command, labels, and review state. |

Publication scope non-claims:

- real vault integration;
- complete publication workflow;
- replacement of vault-local UX;
- editorial policy completeness.

## Practical Writing Order

1. Start each theme from its `scenario.md`.
2. Use `annex.md` to decide which artefacts deserve mention or annex treatment.
3. Use `scorecard.json` only for pilot criteria, not as a universal quality
   score.
4. Use `risk-and-standards-matrix.json` when writing about risks, standards
   direction, and remaining work.
5. Use `task-artefacts.json` when writing about reproducibility, provenance, or
   auditability.
6. Keep private, institutional, and submission-specific wording in the external
   writing vault.
