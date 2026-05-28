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

See [ROADMAP.md](./ROADMAP.md) for the strategic evolution of the CLI.
