# @refarm.dev/runtime-operator

Start and probe the runtime daemon for any refarm-based app.

This is the white-label seam for the runtime experience: the `refarm` CLI, the `dgk`
examples, and any host built on refarm share one launch path and one readiness probe,
so improving the operator here improves it for everyone.

- **launcher** — resolve how to start the daemon (a repo start-script if present, else
  the binary on PATH) per engine (`rust`/`ts`) and spawn it detached via the tokenized
  process-handoff. Knows nothing about which app is launching it.
- **readiness** — probe and poll the daemon's HTTP sidecar until it answers. Storage-
  free: the sidecar URL is **injected** (a base URL or a resolver), so this package
  never reads the sovereign config. An app that resolves its URL from a config node
  passes a resolver; a test or simple host passes a literal URL.

What stays with each app (not here): the `runtime` command surface (commander/chalk),
and recovery hints — those name the app's own commands (`refarm runtime start`,
`dgk runtime start`), so they belong to the app, not the shared operator.

## Usage

```ts
import {
  resolveRuntimeLaunchCommand,
  startRuntimeProcess,
  waitForRuntimeReady,
} from "@refarm.dev/runtime-operator";

const command = resolveRuntimeLaunchCommand(repoRoot, "rust");
const proc = startRuntimeProcess(command);
const ready = await waitForRuntimeReady("http://127.0.0.1:42001", { timeoutMs: 30_000 });
```
