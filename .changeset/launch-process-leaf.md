---
"@refarm.dev/launch-process": minor
"@refarm.dev/cli": patch
---

Add the build-free `@refarm.dev/launch-process` leaf package and keep `@refarm.dev/cli/launch-process` as a compatibility re-export.

Detached launches now install a child-process `error` listener and accept an `onError` callback so missing optional host tools such as `xdg-open` report `ENOENT` without crashing the consumer process.
