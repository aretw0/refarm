# @refarm.dev/capabilities-v1

Neutral, injectable **capability blocks** for refarm hosts — `source:v1`, `records:v1`,
and `vault:v1` — declared once and projected onto every surface (CLI, REPL, TUI, HTTP,
and the agent) by the host.

This package is the **generic substrate** of the two-layer model: it carries **zero
work-domain vocabulary**. A host (the refarm app, or a white-label app) injects its own
plumbing and, optionally, its own data; the package supplies only the neutral verbs and
the provenance/envelope shaping around them.

## The three blocks

| Factory | Verbs | Injected deps |
| --- | --- | --- |
| `createSourceCapabilityGroup(deps)` | `pull` (materialize a source into a snapshot), `status` | `sourceProvider` (a `source:v1` provider) |
| `createRecordsCapabilityGroup(deps?)` | `list`, `enrich` (via an enrichment provider, re-validate) | `loadManifest`, `enrichmentProvider`, `recordsProvider` |
| `createVaultCapabilityGroup(deps)` | `list`/`show`/`dispatch` providers, `init` a records vault | `discover`, `submitEffort`, `newId`, optional `seed` |

Every `run()` is pure over its injected deps and returns an envelope — the host projects
that envelope onto each surface. Nothing here reaches the filesystem, the runtime, or an
app's home directory on its own.

## Composing a host

```ts
import { createCapabilityRegistry, capabilityCliCommands } from "@refarm.dev/cli/capabilities";
import { refarmBuiltinCapabilities } from "@refarm.dev/capabilities-v1";
import { Command } from "commander";

// The host builds its OWN deps bundle: its source provider (and fixtures), how it
// discovers vault providers + submits efforts, and optionally its records manifest
// and vault seed. refarm ships none of that vocabulary.
const builtins = refarmBuiltinCapabilities({
  source: { sourceProvider: myWebSourceProvider },
  vault: myVaultDeps,          // e.g. defaultVaultDeps({ discover, submitEffort })
  records: myRecordsDeps,      // optional — defaults to the neutral empty-manifest deps
});

const registry = createCapabilityRegistry([...builtins, ...myOwnVerbs]);

const program = new Command().name("my-cli");
for (const cmd of capabilityCliCommands(registry.list(), () => ({}))) {
  program.addCommand(cmd);
}
program.parseAsync(process.argv);
```

## Portable default deps

- `defaultSourceDeps(cacheRoot?)` — a web source provider; pass a `cacheRoot` to persist
  snapshots, omit it for an ephemeral temp cache. The block carries no app FS layout — a
  host that wants its home directory derives the path and passes it in.
- `defaultVaultDeps({ discover, submitEffort, newId?, seed? })` — fills in a crypto-UUID
  `newId` and passes `seed` through. The `discover`/`submitEffort` impls are **host
  plumbing** (they read the host's plugin dir / talk to the host's runtime) and must be
  injected.
- `defaultRecordsDeps()` — an **empty** manifest plus the reference enrichment/records
  providers. Fully portable (only contract packages); a host injects `loadManifest` to
  supply real records.

## Test harness

`@refarm.dev/capabilities-v1/testing` exports `createCapabilityTestHarness()`
for white-label apps and examples. It runs flat verbs, resolves group actions,
and owns temporary state paths, so consumer tests can focus on the work-specific
flow instead of repeating registry and temp-directory plumbing.

## Why "neutral"

The blocks know verbs, not domains. `source pull <ref>` takes a ref the caller supplies;
`records enrich` enriches whatever manifest the host loads; `vault init` seeds only what
the host injects. There is no SERPRO, no CNPJ, no "requirements" — a work-specific app
injects that in its own layer and gets the same verbs projected onto every surface.
