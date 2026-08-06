# Architecture Inventory

> Deterministic snapshot generated from workspace manifests and source trees.
> Run `pnpm run architecture:inventory:write` to update and `pnpm run architecture:check` to verify.

This file records observable repository structure. Domain boundaries and language authority remain architectural decisions documented in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Summary

| Measure | Count |
|---|---:|
| Architectural units in `apps/*` and `packages/*` | 143 |
| Distros / hosts (`apps/*`) | 5 |
| Reusable blocks (`packages/*`) | 138 |
| Contract packages (name ends in `-contract-v1`) | 33 |

### Implementation profiles

| Source profile | Workspaces |
|---|---:|
| Astro + TypeScript | 3 |
| JavaScript | 8 |
| JavaScript + TypeScript | 9 |
| metadata-only | 2 |
| Rust | 5 |
| Rust + TypeScript | 2 |
| Rust + WIT | 5 |
| TypeScript | 105 |
| TypeScript + WIT | 4 |

## Structural fitness

- Unique workspace names: pass
- No package depends on an app: pass
- Internal dependency graph is acyclic: pass

## Workspaces

| Workspace | Kind | Source | Internal deps |
|---|---|---|---:|
| `apps/dev`<br>`@refarm.dev/app` | app | Astro + TypeScript | 11 |
| `apps/farmhand`<br>`@refarm.dev/farmhand` | app | TypeScript | 26 |
| `apps/me`<br>`@refarm.me/app` | app | Astro + TypeScript | 14 |
| `apps/refarm`<br>`@refarm.dev/refarm` | app | TypeScript | 60 |
| `apps/site`<br>`@refarm.dev/site` | app | Astro + TypeScript | 5 |
| `packages/agent`<br>`@refarm.dev/agent` | package | Rust | 2 |
| `packages/agent-bench`<br>`@refarm.dev/agent-bench` | package | Rust | 1 |
| `packages/artifact-contract-v1`<br>`@refarm.dev/artifact-contract-v1` | package | TypeScript | 3 |
| `packages/asset-resolver-contract-v1`<br>`@refarm.dev/asset-resolver-contract-v1` | package | TypeScript | 3 |
| `packages/attend-web-v1`<br>`@refarm.dev/attend-web-v1` | package | TypeScript | 5 |
| `packages/authorization-contract-v1`<br>`@refarm.dev/authorization-contract-v1` | package | TypeScript | 3 |
| `packages/automation-contract-v1`<br>`@refarm.dev/automation-contract-v1` | package | TypeScript | 5 |
| `packages/barn`<br>`@refarm.dev/barn` | package | TypeScript + WIT | 6 |
| `packages/browser-driver`<br>`@refarm.dev/browser-driver` | package | TypeScript | 3 |
| `packages/budget-contract-v1`<br>`@refarm.dev/budget-contract-v1` | package | TypeScript | 3 |
| `packages/capabilities`<br>`@refarm.dev/capabilities` | package | TypeScript | 4 |
| `packages/capabilities-v1`<br>`@refarm.dev/capabilities-v1` | package | TypeScript | 15 |
| `packages/capability-homestead-surface`<br>`@refarm.dev/capability-homestead-surface` | package | TypeScript | 5 |
| `packages/capability-host`<br>`@refarm.dev/capability-host` | package | TypeScript | 7 |
| `packages/certificate-contract-v1`<br>`@refarm.dev/certificate-contract-v1` | package | TypeScript | 3 |
| `packages/certificate-local-ca`<br>`@refarm.dev/certificate-local-ca` | package | TypeScript | 5 |
| `packages/channel-policy-v1`<br>`@refarm.dev/channel-policy-v1` | package | TypeScript | 3 |
| `packages/cli`<br>`@refarm.dev/cli` | package | TypeScript | 13 |
| `packages/config`<br>`@refarm.dev/config` | package | JavaScript + TypeScript | 0 |
| `packages/content-projection`<br>`@refarm.dev/content-projection` | package | TypeScript | 4 |
| `packages/context-provider-v1`<br>`@refarm.dev/context-provider-v1` | package | TypeScript | 6 |
| `packages/credentials-contract-v1`<br>`@refarm.dev/credentials-contract-v1` | package | TypeScript | 5 |
| `packages/delegate`<br>`@refarm.dev/delegate` | package | Rust | 3 |
| `packages/delivery-contract-v1`<br>`@refarm.dev/delivery-contract-v1` | package | TypeScript | 3 |
| `packages/delivery-telegram`<br>`@refarm.dev/delivery-telegram` | package | TypeScript | 4 |
| `packages/deps`<br>`@refarm.dev/deps` | package | metadata-only | 0 |
| `packages/diagnostic-bundle-v1`<br>`@refarm.dev/diagnostic-bundle-v1` | package | TypeScript | 3 |
| `packages/dispatch-result-contract-v1`<br>`@refarm.dev/dispatch-result-contract-v1` | package | TypeScript | 3 |
| `packages/dispatch-surface`<br>`@refarm.dev/dispatch-surface` | package | TypeScript | 4 |
| `packages/dispatch-surface-rs`<br>`dispatch-surface` | package | Rust + WIT | 0 |
| `packages/ds`<br>`@refarm.dev/ds` | package | TypeScript | 4 |
| `packages/ds-astro`<br>`@refarm.dev/ds-astro` | package | TypeScript | 4 |
| `packages/effort-contract-v1`<br>`@refarm.dev/effort-contract-v1` | package | TypeScript | 3 |
| `packages/emoji-sas-v1`<br>`@refarm.dev/emoji-sas-v1` | package | TypeScript | 3 |
| `packages/enrichment-contract-v1`<br>`@refarm.dev/enrichment-contract-v1` | package | TypeScript | 3 |
| `packages/enrichment-provider-ref`<br>`@refarm.dev/enrichment-provider-ref` | package | JavaScript + TypeScript | 6 |
| `packages/eslint-config`<br>`@refarm.dev/eslint-config` | package | JavaScript | 0 |
| `packages/event-contract-v1`<br>`@refarm.dev/event-contract-v1` | package | TypeScript | 3 |
| `packages/farm-client`<br>`@refarm.dev/farm-client` | package | JavaScript + TypeScript | 1 |
| `packages/fence`<br>`@refarm.dev/fence` | package | JavaScript | 3 |
| `packages/file-stream-transport`<br>`@refarm.dev/file-stream-transport` | package | TypeScript | 4 |
| `packages/hardening`<br>`@refarm.dev/hardening` | package | TypeScript | 3 |
| `packages/health`<br>`@refarm.dev/health` | package | JavaScript | 5 |
| `packages/heartwood`<br>`@refarm.dev/heartwood` | package | Rust + WIT | 1 |
| `packages/history-contract-v1`<br>`@refarm.dev/history-contract-v1` | package | TypeScript | 4 |
| `packages/homestead`<br>`@refarm.dev/homestead` | package | TypeScript | 14 |
| `packages/host-effects`<br>`host-effects` | package | Rust + WIT | 0 |
| `packages/identity-contract-v1`<br>`@refarm.dev/identity-contract-v1` | package | TypeScript | 3 |
| `packages/identity-heartwood`<br>`@refarm.dev/identity-heartwood` | package | TypeScript | 5 |
| `packages/identity-nostr`<br>`@refarm.me/identity-nostr` | package | TypeScript | 5 |
| `packages/identity-provider-ref`<br>`@refarm.dev/identity-provider-ref` | package | Rust + TypeScript | 5 |
| `packages/infra-cloudflare`<br>`@refarm.dev/infra-cloudflare` | package | TypeScript | 6 |
| `packages/infra-contract-v1`<br>`@refarm.dev/infra-contract-v1` | package | TypeScript | 3 |
| `packages/infra-turbo-cache`<br>`@refarm.dev/infra-turbo-cache` | package | TypeScript | 5 |
| `packages/lab-contract-v1`<br>`@refarm.dev/lab-contract-v1` | package | TypeScript | 5 |
| `packages/local-surface`<br>`@refarm.dev/local-surface` | package | TypeScript | 5 |
| `packages/localization-v1`<br>`@refarm.dev/localization-v1` | package | TypeScript | 3 |
| `packages/login-flow`<br>`@refarm.dev/login-flow` | package | TypeScript | 3 |
| `packages/lsp-code-ops`<br>`@refarm.dev/lsp-code-ops` | package | Rust | 3 |
| `packages/model-catalog-plugin-anthropic`<br>`@refarm.dev/model-catalog-plugin-anthropic` | package | TypeScript | 4 |
| `packages/model-catalog-plugin-openai`<br>`@refarm.dev/model-catalog-plugin-openai` | package | TypeScript | 4 |
| `packages/model-catalog-plugin-stack`<br>`@refarm.dev/model-catalog-plugin-stack` | package | TypeScript | 6 |
| `packages/model-catalog-v1`<br>`@refarm.dev/model-catalog-v1` | package | TypeScript | 3 |
| `packages/model-mock`<br>`@refarm.dev/model-mock` | package | TypeScript | 3 |
| `packages/node-contract-v1`<br>`@refarm.dev/node-contract-v1` | package | TypeScript | 3 |
| `packages/operation-consent-v1`<br>`@refarm.dev/operation-consent-v1` | package | TypeScript | 4 |
| `packages/operation-result-v1`<br>`@refarm.dev/operation-result-v1` | package | TypeScript | 4 |
| `packages/operation-web-v1`<br>`@refarm.dev/operation-web-v1` | package | TypeScript | 5 |
| `packages/operator-state`<br>`@refarm.dev/operator-state` | package | TypeScript | 3 |
| `packages/playbook`<br>`@refarm.dev/playbook` | package | TypeScript | 3 |
| `packages/plugin-courier`<br>`@refarm.dev/plugin-courier` | package | TypeScript | 4 |
| `packages/plugin-manifest`<br>`@refarm.dev/plugin-manifest` | package | JavaScript + TypeScript | 2 |
| `packages/plugin-surface-loader`<br>`@refarm.dev/plugin-surface-loader` | package | TypeScript | 6 |
| `packages/plugin-tem`<br>`@refarm.dev/plugin-tem` | package | TypeScript + WIT | 4 |
| `packages/plugin-wit`<br>`plugin-wit` | package | Rust + WIT | 0 |
| `packages/policy-contract-v1`<br>`@refarm.dev/policy-contract-v1` | package | TypeScript | 3 |
| `packages/pressure-contract-v1`<br>`@refarm.dev/pressure-contract-v1` | package | TypeScript | 4 |
| `packages/process-contract-v1`<br>`@refarm.dev/process-contract-v1` | package | TypeScript | 3 |
| `packages/process-handoff`<br>`@refarm.dev/process-handoff` | package | TypeScript | 4 |
| `packages/process-systemd-user`<br>`@refarm.dev/process-systemd-user` | package | TypeScript | 5 |
| `packages/prompt-contract-v1`<br>`@refarm.dev/prompt-contract-v1` | package | TypeScript | 3 |
| `packages/provenance-contract-v1`<br>`@refarm.dev/provenance-contract-v1` | package | TypeScript | 3 |
| `packages/quality-checker-plugin`<br>`@refarm.dev/quality-checker-plugin` | package | JavaScript + TypeScript | 7 |
| `packages/quality-checker-ref`<br>`@refarm.dev/quality-checker-ref` | package | Rust + TypeScript | 3 |
| `packages/quality-contract-v1`<br>`@refarm.dev/quality-contract-v1` | package | TypeScript + WIT | 3 |
| `packages/records-contract-v1`<br>`@refarm.dev/records-contract-v1` | package | TypeScript | 3 |
| `packages/registry`<br>`@refarm.dev/registry` | package | TypeScript | 5 |
| `packages/release-engine`<br>`@refarm.dev/release-engine` | package | JavaScript | 0 |
| `packages/root`<br>`@refarm.dev/root` | package | TypeScript | 3 |
| `packages/runtime`<br>`@refarm.dev/runtime` | package | TypeScript | 4 |
| `packages/runtime-operator`<br>`@refarm.dev/runtime-operator` | package | TypeScript | 7 |
| `packages/scarecrow`<br>`@refarm.dev/scarecrow` | package | TypeScript | 4 |
| `packages/scarecrow-plugin`<br>`@refarm.dev/scarecrow-plugin` | package | Rust | 3 |
| `packages/session-contract-v1`<br>`@refarm.dev/session-contract-v1` | package | TypeScript | 3 |
| `packages/sidecar-client`<br>`@refarm.dev/sidecar-client` | package | TypeScript | 6 |
| `packages/silo`<br>`@refarm.dev/silo` | package | JavaScript + TypeScript | 6 |
| `packages/skill-contract-v1`<br>`@refarm.dev/skill-contract-v1` | package | TypeScript | 4 |
| `packages/source-contract-v1`<br>`@refarm.dev/source-contract-v1` | package | TypeScript | 3 |
| `packages/source-git`<br>`@refarm.dev/source-git` | package | TypeScript | 4 |
| `packages/source-local`<br>`@refarm.dev/source-local` | package | TypeScript | 4 |
| `packages/source-oslc`<br>`@refarm.dev/source-oslc` | package | TypeScript | 5 |
| `packages/source-provider-ref`<br>`@refarm.dev/source-provider-ref` | package | JavaScript + TypeScript | 5 |
| `packages/source-web`<br>`@refarm.dev/source-web` | package | TypeScript | 4 |
| `packages/sower`<br>`@refarm.dev/sower` | package | TypeScript | 8 |
| `packages/sse-stream-transport`<br>`@refarm.dev/sse-stream-transport` | package | TypeScript | 5 |
| `packages/std`<br>`@refarm.dev/std` | package | TypeScript | 3 |
| `packages/storage-contract-v1`<br>`@refarm.dev/storage-contract-v1` | package | TypeScript | 3 |
| `packages/storage-fs`<br>`@refarm.dev/storage-fs` | package | TypeScript | 4 |
| `packages/storage-memory`<br>`@refarm.dev/storage-memory` | package | TypeScript | 4 |
| `packages/storage-node-view`<br>`@refarm.dev/storage-node-view` | package | TypeScript | 6 |
| `packages/storage-rest`<br>`@refarm.dev/storage-rest` | package | TypeScript | 4 |
| `packages/storage-sqlite`<br>`@refarm.dev/storage-sqlite` | package | TypeScript | 6 |
| `packages/stream-contract-v1`<br>`@refarm.dev/stream-contract-v1` | package | TypeScript | 3 |
| `packages/stream-follower`<br>`@refarm.dev/stream-follower` | package | TypeScript | 4 |
| `packages/surface-quality-v1`<br>`@refarm.dev/surface-quality-v1` | package | TypeScript | 4 |
| `packages/surface-terminal`<br>`@refarm.dev/surface-terminal` | package | TypeScript | 5 |
| `packages/surveyor`<br>`@refarm.dev/surveyor` | package | TypeScript | 5 |
| `packages/sync-contract-v1`<br>`@refarm.dev/sync-contract-v1` | package | TypeScript | 3 |
| `packages/sync-crdt`<br>`@refarm.dev/sync-crdt` | package | TypeScript | 4 |
| `packages/sync-loro`<br>`@refarm.dev/sync-loro` | package | TypeScript | 6 |
| `packages/task-calendar`<br>`@refarm.dev/task-calendar` | package | TypeScript | 4 |
| `packages/task-contract-v1`<br>`@refarm.dev/task-contract-v1` | package | TypeScript | 4 |
| `packages/task-recurrence`<br>`@refarm.dev/task-recurrence` | package | TypeScript | 4 |
| `packages/terminal-plugin`<br>`@refarm.dev/terminal-plugin` | package | TypeScript | 5 |
| `packages/thresher`<br>`@refarm.dev/thresher` | package | JavaScript | 3 |
| `packages/toolbox`<br>`@refarm.dev/toolbox` | package | JavaScript | 3 |
| `packages/tractor`<br>`@refarm.dev/tractor-rs` | package | Rust + WIT | 0 |
| `packages/tractor-ts`<br>`@refarm.dev/tractor` | package | TypeScript | 11 |
| `packages/trust`<br>`@refarm.dev/trust` | package | TypeScript | 3 |
| `packages/tsconfig`<br>`@refarm.dev/tsconfig` | package | metadata-only | 0 |
| `packages/vault-contract-v1`<br>`@refarm.dev/vault-contract-v1` | package | TypeScript + WIT | 8 |
| `packages/vault-surface-ref`<br>`@refarm.dev/vault-surface-ref` | package | JavaScript + TypeScript | 7 |
| `packages/vtconfig`<br>`@refarm.dev/vtconfig` | package | JavaScript + TypeScript | 1 |
| `packages/wa-link`<br>`@refarm.dev/wa-link` | package | JavaScript | 0 |
| `packages/wallet`<br>`@refarm.dev/wallet` | package | TypeScript | 14 |
| `packages/windmill`<br>`@refarm.dev/windmill` | package | JavaScript | 6 |
| `packages/workspace-access-contract-v1`<br>`@refarm.dev/workspace-access-contract-v1` | package | TypeScript | 3 |
| `packages/ws-stream-transport`<br>`@refarm.dev/ws-stream-transport` | package | TypeScript | 6 |
