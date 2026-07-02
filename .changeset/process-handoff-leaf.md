---
"@refarm.dev/process-handoff": minor
"@refarm.dev/cli": patch
---

Add the build-free `@refarm.dev/process-handoff` leaf package. `@refarm.dev/cli/process-handoff` re-exports it for CLI callers, but new consumers should use the leaf package directly.

Detached process handoffs now install a child-process `error` listener and accept an `onError` callback so missing optional host tools such as `xdg-open` report `ENOENT` without crashing the consumer process.
