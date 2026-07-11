# @refarm.dev/sower

Sower is Refarm's public onboarding and import engine. It owns workspace
scaffolding for `refarm init` and the import path for external data sources
such as JSON, CSV, and RSS.

## Role

Combined with its sibling **Thresher**, Sower forms the import/export side of
Refarm's graph data workflow.

- **Sower**: scaffold user-facing workspaces, read public template manifests, and import external data into the graph.
- **Thresher**: export selected graph data and derived bundles.

See [ROADMAP.md](./ROADMAP.md) for the evolution of transformation pipelines and native importers.

Public templates live under `templates/*` and declare their source/config in
`template.json`, so adding a template is a declaration plus a hydration
test rather than a new `SowerCore` branch.

Hydration skips local/generated cache directories that should never reach a new
project: `.astro`, `.turbo`, `dist`, and `node_modules`.

Template manifests can also declare `exclude`, `expectedFiles`, and
`forbiddenPaths`. The root factory command `pnpm run scaffold:templates:test`
hydrates every public template into an isolated temporary directory and verifies
that contract.
