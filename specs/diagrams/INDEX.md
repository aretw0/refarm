# Mermaid Diagram Catalog (MOC)

This file is the Map of Content for architecture-grade diagrams in Refarm.

## Design System Backbone

- Global style config: [mermaid.config.json](./mermaid.config.json)
- Design system guide: [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)
- Source files: `*.mermaid`
- Rendered files: `*.svg`

## Diagram Map

| Domain | Diagram | Purpose |
|---|---|---|
| Architecture | [Architecture Layers](./architecture-layers.svg) | Boundaries between apps, packages, contracts, and infra |
| Runtime | [Plugin Lifecycle](./plugin-lifecycle.svg) | Install/verify/load/execute/teardown lifecycle |
| Data | [Data Flow](./data-flow.svg) | Ingestion to JSON-LD validation and persistence |
| Sync | [Sync CRDT Sequence](./sync-crdt.svg) | Peer operation flow and merge semantics |
| Identity | [Identity Nostr Sequence](./identity-nostr.svg) | Identity, signing, relay verification |
| Persistence | [Storage SQLite / OPFS](./storage-sqlite.svg) | Adapter, migrations, and browser storage runtime |
| Delivery | [CI Pipeline](./ci-pipeline.svg) | Quality/build/e2e/audit orchestration |

## Visual Showcase

### Architecture Layers

Source: [architecture-layers.mermaid](./architecture-layers.mermaid)

![Architecture Layers](./architecture-layers.svg)

### Plugin Lifecycle

Source: [plugin-lifecycle.mermaid](./plugin-lifecycle.mermaid)

![Plugin Lifecycle](./plugin-lifecycle.svg)

### Data Flow

Source: [data-flow.mermaid](./data-flow.mermaid)

![Data Flow](./data-flow.svg)

### Sync CRDT Sequence

Source: [sync-crdt.mermaid](./sync-crdt.mermaid)

![Sync CRDT Sequence](./sync-crdt.svg)

### Identity Nostr Sequence

Source: [identity-nostr.mermaid](./identity-nostr.mermaid)

![Identity Nostr Sequence](./identity-nostr.svg)

### Storage SQLite / OPFS

Source: [storage-sqlite.mermaid](./storage-sqlite.mermaid)

![Storage SQLite / OPFS](./storage-sqlite.svg)

### CI Pipeline

Source: [ci-pipeline.mermaid](./ci-pipeline.mermaid)

![CI Pipeline](./ci-pipeline.svg)

## Regeneration

```bash
npm run diagrams:fix
```

After editing any `*.mermaid` or `mermaid.config.json`, regenerate SVGs and commit both source and rendering.
