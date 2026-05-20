# @refarm.dev/sower

Sower is Refarm's public onboarding and import engine. It owns workspace
scaffolding for `refarm init` and the import path for external data sources
such as JSON, CSV, and RSS.

## Role

Combined with its sibling **Thresher**, Sower forms the import/export side of
Refarm's graph data workflow.

- **Sower**: scaffold user-facing workspaces and import external data into the graph.
- **Thresher**: export selected graph data and derived bundles.

See [ROADMAP.md](./ROADMAP.md) for the evolution of transformation pipelines and native importers.
