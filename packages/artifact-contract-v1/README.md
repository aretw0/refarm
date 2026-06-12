# @refarm.dev/artifact-contract-v1

Shared lifecycle base types for managed artifacts in the Refarm platform.

## Types

- `ArtifactStatus` — `"draft" | "ready" | "active" | "archived"`
- `ManagedArtifact` — base interface extended by domain contracts (e.g. `automation-contract-v1`)
- `ARTIFACT_TERMINAL_STATES` — `ReadonlySet<ArtifactStatus>` containing `"archived"`
- `canTransition(from, to)` — pure guard function for valid status transitions
- `TaskArtifactManifest` — manifest for task, lab, or validation outputs that
  need stable paths, media types, provenance, hashes, and review state
- `TaskArtifactReference` — one generated output such as a dataset, report,
  audit trail, receipt, log, or nested manifest
- `ArtifactProvenance` — producer/run/source metadata for a generated output
- `validateTaskArtifactManifest(value)` — runtime validator that returns
  path-aware issues for JS consumers and CI checks
- `isTaskArtifactManifest(value)` — type guard for validated manifests
- `selectTaskArtifacts(manifest, selection)` — pure helper for consumers that
  need artifacts by role, review state, media type, label, source, or producer
- `findTaskArtifactById(manifest, id)` — pure helper for stable-id lookup

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

Task artifact manifests are intentionally generic. They describe durable outputs
from a task or lab run without owning the consumer's domain schema.

artifact `id` values must be unique inside one manifest. Consumers may use them
for stable lookup through `findTaskArtifactById`, while labels, roles, and review
state are better for category selection.

```ts
import type { TaskArtifactManifest } from "@refarm.dev/artifact-contract-v1";

const manifest: TaskArtifactManifest = {
  schema: "refarm.task-artifacts.v1",
  taskId: "task-wallet-poc",
  effortId: "effort-wallet-poc-001",
  createdAt: "2026-06-11T00:00:00.000Z",
  artifacts: [
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
import { validateTaskArtifactManifest } from "@refarm.dev/artifact-contract-v1";

const result = validateTaskArtifactManifest(manifest);

if (!result.ok) {
  throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
}
```

After validation, consumers should query the manifest instead of hard-coding
producer file names:

```ts
import { selectTaskArtifacts } from "@refarm.dev/artifact-contract-v1";

const acceptedReports = selectTaskArtifacts(manifest, {
  roles: ["report", "audit-trail"],
  reviewStates: ["accepted"],
  labels: ["publication"],
});
```
