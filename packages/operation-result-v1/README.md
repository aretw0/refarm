# `@refarm.dev/operation-result-v1`

A surface-neutral result envelope for named operations. It carries a short summary, numeric
metrics and bounded findings. It deliberately cannot carry stdout, stderr, argv, environment or an
open plugin payload.

Every string is redacted through `@refarm.dev/diagnostic-bundle-v1` before it crosses a surface.
Ceilings are part of the wire contract so a host can retain and transport one result without
becoming a terminal proxy or an unbounded log store.
