# Architecture Context Map

> Provisional strategic map generated from `architecture-context-map.v1.json`.
> It identifies authority anchors and integration seams; it does not classify every package as a bounded context.

Read relationships from upstream supplier to downstream consumer. `established-boundary` means an accepted contract or ADR already defines the separation; `candidate-boundary` is a useful current grouping that still needs pressure from implementation and additional consumers.

## Contexts

| Context | Maturity | Purpose | Authority anchors |
|---|---|---|---|
| **Agency and Models**<br>`agency-models` | candidate-boundary | Select models and credentials, maintain sessions and turn governed work into agent execution. | `packages/agent`<br>`packages/delegate`<br>`packages/model-catalog-v1`<br>`packages/model-catalog-plugin-stack`<br>`packages/prompt-contract-v1`<br>`packages/session-contract-v1` |
| **Sovereign Data Substrate**<br>`data-substrate` | established-boundary | Persist, query and synchronize local-first state behind replaceable contracts. | `packages/storage-contract-v1`<br>`packages/storage-fs`<br>`packages/storage-memory`<br>`packages/storage-sqlite`<br>`packages/sync-contract-v1`<br>`packages/sync-loro` |
| **Execution Kernel**<br>`execution-kernel` | established-boundary | Load and execute governed plugins while enforcing the native runtime and WIT boundary. | `packages/barn`<br>`packages/capabilities-v1`<br>`packages/capability-host`<br>`packages/plugin-manifest`<br>`packages/plugin-wit`<br>`packages/tractor`<br>`packages/tractor-ts` |
| **Identity, Authority and Trust**<br>`identity-trust` | established-boundary | Represent principals, credentials, authorization, consent and trust decisions. | `packages/authorization-contract-v1`<br>`packages/credentials-contract-v1`<br>`packages/identity-contract-v1`<br>`packages/operation-consent-v1`<br>`packages/policy-contract-v1`<br>`packages/trust` |
| **Interaction and Delivery**<br>`interaction-delivery` | candidate-boundary | Expose operations through replaceable surfaces and deliver outcomes over operator channels. | `packages/channel-policy-v1`<br>`packages/delivery-contract-v1`<br>`packages/delivery-telegram`<br>`packages/operation-result-v1`<br>`packages/surface-terminal` |
| **Platform Operations**<br>`platform-operations` | candidate-boundary | Boot, observe, diagnose and recover node-local processes and infrastructure. | `packages/diagnostic-bundle-v1`<br>`packages/health`<br>`packages/process-contract-v1`<br>`packages/runtime`<br>`packages/runtime-operator` |
| **Records and Knowledge**<br>`records-knowledge` | candidate-boundary | Materialize sources and project neutral, provenance-carrying knowledge records. | `packages/content-projection`<br>`packages/enrichment-contract-v1`<br>`packages/records-contract-v1`<br>`packages/source-contract-v1`<br>`packages/storage-node-view` |
| **Sovereign Context**<br>`sovereign-context` | established-boundary | Resolve and explain the active home, node, namespace, workspace and operator context. | `packages/config`<br>`packages/context-provider-v1`<br>`packages/node-contract-v1`<br>`packages/operator-state`<br>`packages/workspace-access-contract-v1` |
| **Work Control**<br>`work-control` | candidate-boundary | Describe tasks, efforts, automations and their durable lifecycle independently of the worker. | `packages/automation-contract-v1`<br>`packages/effort-contract-v1`<br>`packages/task-calendar`<br>`packages/task-contract-v1`<br>`packages/task-recurrence` |

## Relationships

| Upstream | Downstream | Relationship | Explicit seams |
|---|---|---|---|
| `data-substrate` | `execution-kernel` | capability-supplier | `packages/storage-contract-v1`<br>`packages/sync-contract-v1` |
| `data-substrate` | `records-knowledge` | persistence-supplier | `packages/storage-contract-v1` |
| `execution-kernel` | `agency-models` | execution-host | `packages/plugin-wit`<br>`packages/capabilities-v1` |
| `identity-trust` | `agency-models` | credential-and-consent-supplier | `packages/credentials-contract-v1`<br>`packages/operation-consent-v1` |
| `identity-trust` | `execution-kernel` | policy-supplier | `packages/authorization-contract-v1`<br>`packages/policy-contract-v1` |
| `interaction-delivery` | `work-control` | operation-ingress | `packages/delivery-contract-v1`<br>`packages/operation-result-v1` |
| `platform-operations` | `execution-kernel` | lifecycle-host | `packages/process-contract-v1`<br>`packages/diagnostic-bundle-v1` |
| `records-knowledge` | `agency-models` | knowledge-supplier | `packages/records-contract-v1`<br>`packages/source-contract-v1` |
| `sovereign-context` | `platform-operations` | context-supplier | `packages/node-contract-v1` |
| `sovereign-context` | `work-control` | context-supplier | `packages/workspace-access-contract-v1` |
| `work-control` | `agency-models` | work-supplier | `packages/effort-contract-v1`<br>`packages/task-contract-v1` |

## Dependency pressure (observational)

This compares manifest-level dependencies among authority anchors with the strategic relationships above. It includes development and peer dependencies, so an undeclared pair is a question to investigate, not an architecture violation.

Observed 33 cross-context edges across 22 pairs. Of the undeclared pressure, 16 non-dev edges across 12 pairs need architectural explanation; 4 edges across 3 pairs are development-only observations.

| Supplier context | Consumer context | Manifest edges | Scopes | Declared relationship |
|---|---|---:|---|---|
| `agency-models` | `data-substrate` | 1 | dependencies | no — investigate |
| `agency-models` | `execution-kernel` | 1 | devDependencies | no — dev-only observation |
| `agency-models` | `identity-trust` | 1 | devDependencies | no — dev-only observation |
| `agency-models` | `platform-operations` | 1 | dependencies | no — investigate |
| `agency-models` | `sovereign-context` | 1 | dependencies | no — investigate |
| `data-substrate` | `execution-kernel` | 3 | dependencies, devDependencies | yes |
| `data-substrate` | `identity-trust` | 1 | dependencies | no — investigate |
| `data-substrate` | `records-knowledge` | 2 | dependencies | yes |
| `execution-kernel` | `agency-models` | 3 | cargo-path, devDependencies | yes |
| `execution-kernel` | `platform-operations` | 1 | dependencies | no — investigate |
| `identity-trust` | `execution-kernel` | 1 | dependencies | yes |
| `interaction-delivery` | `execution-kernel` | 1 | dependencies | no — investigate |
| `platform-operations` | `execution-kernel` | 1 | dependencies | yes |
| `platform-operations` | `interaction-delivery` | 1 | dependencies | no — investigate |
| `records-knowledge` | `execution-kernel` | 5 | dependencies, devDependencies | no — investigate |
| `sovereign-context` | `execution-kernel` | 2 | dependencies | no — investigate |
| `sovereign-context` | `interaction-delivery` | 1 | devDependencies | no — dev-only observation |
| `sovereign-context` | `platform-operations` | 2 | dependencies | yes |
| `sovereign-context` | `records-knowledge` | 1 | dependencies | no — investigate |
| `sovereign-context` | `work-control` | 1 | dependencies | yes |
| `work-control` | `data-substrate` | 1 | dependencies | no — investigate |
| `work-control` | `execution-kernel` | 1 | dependencies | no — investigate |

## Reading rules

- An anchor has one strategic owner in this map. Other packages may depend on it without acquiring its authority.
- A seam is a contract or ABI through which two contexts integrate; direct imports may exist during migration, but they are not the desired source of shared meaning.
- Unlisted packages are intentionally unclassified. Add them only when ownership or language ambiguity is causing real coordination cost.
- Update the JSON source and run `pnpm run architecture:context-map:write`; CI verifies anchors and seams against the repository inventory.
