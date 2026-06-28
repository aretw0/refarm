# @refarm.dev/launch-process

Build-free tokenized process helpers for Refarm and consumer CLIs.

This is the leaf package for consumers that only need the
`@refarm.dev/cli/launch-process` surface without installing the full Refarm CLI
dependency closure.

## Boundary

- Produces structured `{ command, args, cwd, display }` process specs.
- Adapts runner-style `(command, args, options) => Promise<void>` seams.
- Fits `@refarm.dev/artifact-contract-v1` process provenance.
- Does not import `@refarm.dev/cli`, Homestead, runtime, trust, or config.

## Example

```ts
import {
	createLaunchProcessSpecFromRunner,
	launchDetachedProcess,
} from "@refarm.dev/launch-process";

const process = createLaunchProcessSpecFromRunner(
	"node",
	["scripts/prepare_lab_datasets.mjs", "--json"],
	{
		cwd: "/workspaces/vault-seed",
		display: "node scripts/prepare_lab_datasets.mjs --json",
	},
);
```

Detached launches install an `error` listener by default so missing host tools
such as `xdg-open` do not crash the caller through an unhandled child-process
event. Pass `onError` when the consumer should surface or log spawn failures:

```ts
launchDetachedProcess(process, {
	onError(error) {
		if (error.code === "ENOENT") {
			// Report a missing opener or optional host tool.
		}
	},
});
```
