---
"@refarm.dev/capabilities": minor
"@refarm.dev/capabilities-v1": patch
---

Shared capability dispatch seam. `dispatchCapability` (and the pure `resolveCapabilityInvocation`)
in `@refarm.dev/capabilities` define "resolve a group-or-flat verb from tokens → validate its input
against the derived schema → run" ONCE, returning a single `unresolved | invalid | ran` outcome
every surface renders its own way. The CLI (`refarm` chat REPL) and the TUI now route through it
instead of each re-implementing resolve+run — which also fixes a real bug (the TUI ran a flat verb
with EMPTY input, ignoring its argv) and extends schema validation (Ajv) to those surfaces. Web,
HTTP, CLI and TUI now enforce one contract from one derived schema.
