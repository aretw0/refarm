# Factory Scaffold Inventory

Refarm already has a strong `packages/*` factory: `turbo gen package` creates the common package archetypes and `pnpm run validate-packages` blocks scaffold drift for packages and basic app hygiene.

The broader software-factory gap is now tracked by:

```bash
pnpm run scaffold:inventory
pnpm run scaffold:inventory:json
pnpm run scaffold:inventory:strict
pnpm run scaffold:inventory:test
pnpm run scaffold:generators:test
pnpm run scaffold:templates:test
```

The inventory is read-only. It classifies the workspace roots that should eventually have coherent generators:

- `packages/*`: covered by `turbo gen package`.
- `examples/*`: `example/dgk-workbench` is covered by `turbo gen example`; `scaffold:generators:test` materializes a representative generated example and sends it through the inventory.
- `apps/*`: covered by `turbo gen app` archetypes for Astro apps, CLI apps, and service/sidecar apps; `scaffold:generators:test` materializes one of each.
- `validations/*`: covered by `turbo gen validation` archetypes for script POCs, fixture-heavy POCs, WASM packages, substrate probes, Astro/WASI validations, and composite validation workspaces; `scaffold:generators:test` materializes each archetype.
- `templates/*`: covered when a public Sower template declares `refarm.template.json`; strict mode blocks build/cache output that Sower would copy into generated projects, and `scaffold:templates:test` hydrates each public template from its manifest contract.

Current pressure snapshot from `pnpm run scaffold:inventory`:

- 111 covered workspaces/templates.
- 0 workspaces need generators.
- 1 example is legacy/review (`examples/matrix-bridge`).

Priority order:

1. Decide whether `examples/matrix-bridge` graduates to a covered archetype or gets removed from the active example set.
2. Extend conformance from generated workspace shape to cheap command smoke for apps, examples, and validations.

Completed factory pressure:

- Repeated T1/T2/T3 test plumbing now lives in `@refarm.dev/capabilities-v1/testing`.
- Public Sower templates now declare `expectedFiles`/`forbiddenPaths` and run through `pnpm run scaffold:templates:test`.
- Internal Turbo app/example/validation generators now materialize representative workspaces and require `scaffold:inventory` coverage.
