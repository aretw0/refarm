# POC Writing Handoff

Status: sanitized handoff for continuing proposal writing outside this
repository. This is not submission text and should not be copied as-is.

## Boundary

- Do not write from Refarm into external proposal vaults.
- Do not cite Refarm product names when the target writing cannot name this
  repository.
- Treat generated artifacts as evidence for writing, not as final annexes.
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
| Standards alignment | A standards matrix maps clauses to artifacts and records gaps. | Say "inspired by" or "compatible direction", not "conformant". |
| Legal or institutional compliance | A qualified compliance review exists outside the POC. | Say the POC makes reviewable evidence explicit. |
| Production UX or accessibility | A UI surface exists and is checked with accessibility and cross-platform tests. | Say the data flow is validated, not the final experience. |
| Vault integration | A consumer project reads the manifest without copying Refarm internals. | Say the artifacts are ready for downstream consumption. |

Near-term promotion should favor claims that strengthen all consumers:

1. Link the extension sandbox to the existing real WASM validation before
   claiming real plugin execution for Theme 1.
2. Expand standards matrices into dedicated conformance suites only when a
   formal claim is actually needed.
3. Keep vault, notebook, and publication UX in consumer projects; promote only
   shared manifest, provenance, scoring, and preflight primitives back into
   Refarm.

## Benchmark Readiness Assessment

A read-only comparison against the local writing benchmark shows that the POCs
are already strong enough to support proposal writing as technical evidence, but
they should not be treated as complete award-style works by themselves.

The current POCs are strong in these dimensions:

| Dimension | Current state |
| --- | --- |
| Executable evidence | Each theme has deterministic fixtures, tests, manifests, hashes, and a consumer evidence index. |
| Reader path | Each theme starts with `scenario.md`, continues through `annex.md`, and ends with limits and claim-promotion evidence. |
| Claim restraint | `limits.md`, risk matrices, and the index boundary prevent overstating conformance, production readiness, or real integrations. |
| Reproducibility | `pnpm run validation-pocs:test` regenerates or validates the synthetic evidence and manifest selectors. |
| Downstream handoff | `refarm.task-artifacts.v1` manifests let a writing vault, Lab, or consumer project navigate evidence without importing Refarm internals. |

The gap against a mature award-style work is not lack of POC artifacts. The gap
is turning those artifacts into a fuller implementation argument:

| Gap | Writing implication | Refarm-side action |
| --- | --- | --- |
| Architecture reference | The proposal needs a clean architecture section beyond generated evidence. | Keep architecture language generic; use POC annexes as evidence, not final diagrams. |
| Implementation plan | The proposal needs phases, roles, adoption path, and production guardrails. | Use scorecards and limits as pilot gates; avoid claiming production readiness. |
| Impact model | The proposal needs expected institutional benefit, possibly with ranges. | Provide evidence shape and measurable indicators; keep financial or institutional projections in the writing vault. |
| External validation | Standards and compliance claims need outside review or formal suite evidence. | Keep current language as alignment/gap analysis until a dedicated conformance suite exists. |
| Real integration | Theme 3 especially needs consumer validation before claiming vault integration. | Continue promoting generic manifest/provenance contracts; leave vault UX to consumer projects. |

Practical answer: the POCs are rich enough to ground strong proposals, especially
as appendable evidence and pilot-validation material. They are not yet a
drop-in replacement for the benchmark winner's full narrative because that
benchmark combines POC results with architecture, implementation path, expected
impact, costs, and institutional alignment.

The safest writing posture is:

- use the POCs as proof that the technical mechanism is concrete and
  reproducible;
- use the benchmark style for structure: architecture, implementation, POC
  result, limitations, impact, and next phase;
- keep institutional estimates, submission language, and confidential context
  in the external writing vault;
- only promote a claim when it maps to a manifest artifact, command, or
  independently reviewed source.

## POC Narrative Placement

Do not hide the POC until the end of the proposal, and do not present the full
POC before the reader understands the problem.

Use this order when translating evidence into proposal text:

1. Open with the concrete institutional problem and why the current workflow is
   costly, fragile, slow, or hard to audit.
2. Establish the technical and regulatory context with external references and
   existing practices.
3. Introduce the POC early as a controlled validation method: "a synthetic
   proof of concept was built to test the operating hypothesis".
4. Explain the architecture and workflow under test before showing result
   tables.
5. Present POC results as objective evidence: criteria, observed artifacts,
   pass/watch/fail gates, and limits.
6. Close with adoption path, risks, mitigations, and the next pilot boundary.

This keeps the POC as a thread through the work instead of a late appendix. The
reader should know that a POC exists early, but should only see the full
evidence after the proposal has explained why the POC matters.

Before promoting a POC result into prose, check the proposal evidence matrix in
[POC Prize Readiness](POC_PRIZE_READINESS.md#proposal-evidence-matrix): every
strong claim should have a problem, architectural decision, artifact, metric,
and current limit.

Avoid two failure modes:

- theory-first text where the POC appears only at the end and feels bolted on;
- demo-first text where artifacts appear before the institutional problem and
  architecture are clear.

## Validation Command

```bash
pnpm run validation-pocs:test
```

This command runs all three synthetic POCs, validates every
`refarm.task-artifacts.v1` manifest, and verifies consumer selection through
`@refarm.dev/artifact-contract-v1`. It also checks
`validations/poc-evidence-index.json`, the reader-facing map from each theme to
its scenario, annex, scorecard, risk matrix, limits, and claim-promotion
evidence.

## Theme Claim Map

Use this table as a writing checklist. It is intentionally sanitized: it names
the technical shape, the local evidence, and the limit that should stay visible
until a stronger validation exists. The same map is encoded as `writingClaims`
inside `validations/poc-evidence-index.json` for downstream tools or vaults that
prefer machine-readable evidence navigation.

| Theme | Careful claim | Primary evidence | Do not say yet |
| --- | --- | --- | --- |
| Extension sandbox | A host can make extension capability decisions explicit and reviewable before promotion. | `policy-decision.json`, `sandbox-report.json`, `annex.md` | Production plugin governance is solved. |
| Extension sandbox | Failure policy can be modeled as an operational choice, not hidden behavior. | `sandbox-report.md`, `scorecard.json`, `limits.md` | Real host performance or complete isolation is proven. |
| Extension sandbox | Synthetic policy evidence is connected to a real WASM validation path. | `runtime-evidence.json`, `task-artifacts.json` | The synthetic report itself executed real WASM plugins. |
| Extension sandbox | A coding-agent workflow can be framed with explicit capability review, provenance, and human promotion gates. | `coding-agent-evidence.json`, `coding-agent-smoke.json`, `coding-agent-temp-workspace.json`, `policy-decision.json`, `limits.md` | A production autonomous coding agent or safe unattended repository mutation is proven. |
| Citizen data wallet | Purpose, scope, expiration, and selective disclosure can be represented as reviewable artifacts. | `service-request.json`, `authorization-receipt.json`, `selective-presentation.json` | Formal wallet interoperability is proven. |
| Citizen data wallet | Tamper detection and revocation can be made visible to the operator and holder journey. | `audit-trail.md`, `revocation-event.json`, `consent-decision.json` | Legal compliance or production UX is ready. |
| Citizen data wallet | The flow can be evaluated with pilot criteria before institutional adoption. | `scorecard.json`, `risk-and-standards-matrix.json`, `limits.md` | LGPD, W3C VC, OpenID4VP, or EUDI conformance is certified. |
| Governed note box | Local knowledge artifacts can keep provenance while separating intake, lab, and publication snapshots. | `metadata-index.json`, `lab-snapshot.json`, `publication-snapshot.json` | Real vault integration is implemented. |
| Governed note box | Publication can remain blocked on human review while still producing useful lab evidence. | `publication-preflight.json`, `human-review.md`, `scorecard.json` | Editorial policy completeness is proven. |
| Governed note box | Downstream consumers can navigate evidence through manifest selectors instead of hard-coded file names. | `consumer-evidence.json`, `task-artifacts.json`, `poc-evidence-index.json` | Obsidian, Astro, Marimo, or work-mirror UX is owned by Refarm. |

For all themes, phrase the POC as "repeatable validation evidence" or "pilot
evidence" rather than as a finished implementation. Stronger wording should
come only after a real runtime path, consumer project, formal conformance suite,
or qualified institutional review produces its own artifact.

## Theme 1 Evidence: Extension Sandbox

Extension artifact root:

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
| `coding-agent-evidence.json` | Support Theme 1 coding-agent framing. | Capability review, provenance, and human promotion gates can be described without claiming autonomous coding readiness. |
| `coding-agent-smoke.json` | Support Theme 1 demonstration mechanics. | A proposed patch, review packet, denied-capability receipt, and untouched protected surfaces are recorded without claiming model-driven patch generation. |
| `coding-agent-temp-workspace.json` | Support Theme 1 promotion mechanics. | The proposed patch can be rehearsed in a temporary workspace copy while repository promotion remains review-gated, without claiming complete sandboxing or unattended writes. |
| `limits.md` | Support adoption restraint and non-claims. | Non-claims, adoption risks, and promotion criteria are explicit. |
| `task-artifacts.json` | Support provenance claims. | artifacts have hashes, media types, producer command, and review state. |

Extension non-claims:

- real WebAssembly execution inside the synthetic sandbox report;
- production plugin governance;
- production autonomous coding-agent operation;
- safe unattended repository mutation;
- real model-driven patch generation;
- complete repository sandboxing;
- full security certification;
- performance of a real plugin host.

## Theme 2 Evidence: Citizen Data Wallet

Wallet artifact root:

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
| `limits.md` | Support adoption restraint and non-claims. | Non-claims, adoption risks, and promotion criteria are explicit. |
| `task-artifacts.json` | Support provenance claims. | artifacts have hashes, media types, producer command, and review state. |

Wallet non-claims:

- EUDI wallet interoperability;
- W3C VC or OpenID4VP/OpenID4VCI conformance;
- LGPD compliance;
- production UX or accessibility readiness.

## Theme 3 Evidence: Governed Note Box

Note-box artifact root:

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
| `limits.md` | Support adoption restraint and non-claims. | Non-claims, adoption risks, and promotion criteria are explicit. |
| `task-artifacts.json` | Support provenance claims. | artifacts have hashes, media types, producer command, labels, and review state. |

Publication scope non-claims:

- real vault integration;
- complete publication workflow;
- replacement of vault-local UX;
- editorial policy completeness.

## Practical Writing Order

1. Start from `validations/poc-evidence-index.json` to locate the theme and
   reader path.
2. Read each theme from its `scenario.md`.
3. Use `annex.md` to decide which artifacts deserve mention or annex treatment.
4. Use `scorecard.json` only for pilot criteria, not as a universal quality
   score.
5. Use `risk-and-standards-matrix.json` when writing about risks, standards
   direction, and remaining work.
6. Use `limits.md` before final wording to keep claims inside proven evidence.
7. Use `task-artifacts.json` when writing about reproducibility, provenance, or
   auditability.
8. Keep private, institutional, and submission-specific wording in the external
   writing vault.
