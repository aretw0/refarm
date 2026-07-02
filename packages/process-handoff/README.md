# @refarm.dev/process-handoff

Build-free tokenized process helpers for host and consumer CLIs.

This is the leaf package for consumers that need structured process specs,
runner adaptation, detached process starts, or artifact provenance without
installing a CLI dependency closure.

Long-running local services need one more layer than a detached spawn: a
workspace-scoped lease that records owner, target, pid, ports, health URL, log
path, and stop policy. The design baseline lives in
`specs/features/2026-07-01-process-handoff-lease.md`; the important boundary is
that process leases belong in this neutral process layer, not in `apps/site`,
Refarm Studio, or the runtime-agent product surface.

## Boundary

- Produces structured `{ command, args, cwd, display }` process specs.
- Adapts runner-style `(command, args, options) => Promise<void>` inputs.
- Fits `@refarm.dev/artifact-contract-v1` process provenance.
- Does not import `@refarm.dev/cli`, Homestead, runtime, trust, or config.

## Example

```ts
import {
	createProcessHandoffSpecFromRunner,
	startDetachedProcessHandoff,
} from "@refarm.dev/process-handoff";

const process = createProcessHandoffSpecFromRunner(
	"node",
	["scripts/prepare_workflow_outputs.mjs", "--json"],
	{
		cwd: "/workspaces/consumer-project",
		display: "node scripts/prepare_workflow_outputs.mjs --json",
	},
);
```

Detached process handoffs install an `error` listener by default so missing host tools
such as `xdg-open` do not crash the caller through an unhandled child-process
event. Pass `onError` when the consumer should surface or log spawn failures:

```ts
startDetachedProcessHandoff(process, {
	onError(error) {
		if (error.code === "ENOENT") {
			// Report a missing opener or optional host tool.
		}
	},
});
```
