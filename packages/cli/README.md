# @refarm.dev/cli

Shared CLI contracts and process-safe helpers used by the Refarm app and other
operator surfaces.

This package is not the Refarm application entrypoint. It holds reusable
building blocks that should remain useful outside the app layer:

- JSON success/error envelopes and command-result parsing.
- Command handoff builders, including agnostic application/binary command
  helpers. App-specific wrappers belong in their app layer.
- Command plan and execution plan envelopes.
- Surface action affordance formatting and selection.
- Browser-open, launch-process, launch-readiness, Git, and GitHub Actions
  adapters.
- Runner-style process adapters for consumer CLIs that already expose
  `(command, args, options) => Promise<void>` execution seams.
- Refarm status schema contracts and compatibility aliases where public callers
  still rely on Refarm-specific names.

## Boundary

Keep product orchestration in `apps/refarm`. Move reusable contracts and
spawn-safe process helpers here when more than one surface or command can use
them.

Prefer agnostic primary names for new reusable helpers. Keep Refarm-specific
exports only when they describe a public Refarm contract.

For host browser handoff, prefer `BROWSER_OPEN_COMMAND` as the generic override.
`REFARM_BROWSER_OPEN_COMMAND` remains supported only as a Refarm compatibility
alias.

## Runner Adapter

Consumer CLIs can keep their own command vocabulary and inject Refarm's process
adapter only at the execution boundary:

```ts
import { createLaunchProcessRunner } from "@refarm.dev/cli/launch-process";

const runner = createLaunchProcessRunner();
await runner("node", ["scripts/prepare_lab_datasets.mjs"], {
	cwd: "/workspaces/vault",
	display: "node scripts/prepare_lab_datasets.mjs",
});
```

The adapter builds a structured process spec, executes it without shell parsing,
and rejects non-zero exit codes. This is the intended bridge for product-local
CLIs such as vault cockpits: their commands stay local, while Refarm can later
record richer handoffs, provenance, and task artifacts around the same process
boundary.

See [ROADMAP.md](./ROADMAP.md) for the strategic evolution of the CLI.
