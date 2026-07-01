# Tool-less Orchestrator Results

| Check | Expected | Result |
| --- | --- | --- |
| Conductor has no environment tools | `environmentToolCapabilities: []` | pass |
| Actor is keyless | `keyless: true`, `holdsOperatorKeys: false` | pass |
| Request carries no secrets | `secretMaterialProvided: false` | pass |
| Capabilities are bounded | request capabilities are a subset of actor policy | pass |
| Evidence fence excludes keys and ambient shell | `operator-keys`, `ambient-shell`, `unbounded-egress` excluded | pass |
| Source hash is re-observed | actor hash matches source-truth hash | pass |
| Compact view is not truth | raw evidence remains recoverable | pass |
