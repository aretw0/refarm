# @refarm.dev/artefact-contract-v1

Shared lifecycle base types for managed artefacts in the Refarm platform.

## Types

- `ArtefactStatus` — `"draft" | "ready" | "active" | "archived"`
- `ManagedArtefact` — base interface extended by domain contracts (e.g. `automation-contract-v1`)
- `ARTEFACT_TERMINAL_STATES` — `ReadonlySet<ArtefactStatus>` containing `"archived"`
- `canTransition(from, to)` — pure guard function for valid status transitions
- `TaskArtefactManifest` — manifest for task, lab, or validation outputs that
  need stable paths, media types, provenance, hashes, and review state
- `TaskArtefactReference` — one generated output such as a dataset, report,
  audit trail, receipt, log, or nested manifest
- `ArtefactProvenance` — producer/run/source metadata for a generated output
- `validateTaskArtefactManifest(value)` — runtime validator that returns
  path-aware issues for JS consumers and CI checks
- `isTaskArtefactManifest(value)` — type guard for validated manifests
- `selectTaskArtefacts(manifest, selection)` — pure helper for consumers that
  need artefacts by role, review state, media type, label, source, or producer
- `findTaskArtefactById(manifest, id)` — pure helper for stable-id lookup

## Transition graph

```
draft ──validate()──► ready ──activate()──► active
  ▲                     │                     │
  └──────────────────────◄──deactivate()───────┘
                         │
                    archive() ◄──── (any state)
                         ▼
                      archived  (terminal)
```

## Task output manifests

Task artefact manifests are intentionally generic. They describe durable outputs
from a task or lab run without owning the consumer's domain schema.

```ts
import type { TaskArtefactManifest } from "@refarm.dev/artefact-contract-v1";

const manifest: TaskArtefactManifest = {
  schema: "refarm.task-artefacts.v1",
  taskId: "task-wallet-poc",
  effortId: "effort-wallet-poc-001",
  createdAt: "2026-06-11T00:00:00.000Z",
  artefacts: [
    {
      id: "wallet-audit-trail",
      uri: "fixtures/expected/audit-trail.md",
      mediaType: "text/markdown",
      role: "audit-trail",
      reviewState: "accepted",
      hash: {
        algorithm: "sha256",
        value: "0000000000000000000000000000000000000000000000000000000000000000",
      },
      provenance: {
        runId: "wallet-poc-001",
        producer: "wallet:poc",
        command: "pnpm run wallet:poc",
        source: "validations/citizen-data-wallet-poc",
        sourceVersion: "synthetic-v1",
        producedAt: "2026-06-11T00:00:00.000Z",
      },
    },
  ],
};
```

Consumers such as `vault-seed` can map these references to Lab datasets,
publication reports, or audit notebooks while keeping vault-specific fields in
their own manifests.

Runtime consumers should validate untrusted or generated manifests before using
their paths:

```ts
import { validateTaskArtefactManifest } from "@refarm.dev/artefact-contract-v1";

const result = validateTaskArtefactManifest(manifest);

if (!result.ok) {
  throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
}
```

After validation, consumers should query the manifest instead of hard-coding
producer file names:

```ts
import { selectTaskArtefacts } from "@refarm.dev/artefact-contract-v1";

const acceptedReports = selectTaskArtefacts(manifest, {
  roles: ["report", "audit-trail"],
  reviewStates: ["accepted"],
  labels: ["publication"],
});
```
