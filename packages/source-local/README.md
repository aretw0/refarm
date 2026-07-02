# @refarm.dev/source-local

Local working-tree implementation of the `source:v1` capability. It materializes
an existing path as a live local source without cloning, copying, or fetching.

Use this adapter when the caller intentionally needs the current filesystem state,
including dirty and untracked git files. Use `@refarm.dev/source-git` when the
caller needs a clean cached snapshot of a remote repository.

## Example

```ts
import { createLocalSourceProvider } from "@refarm.dev/source-local";

const provider = createLocalSourceProvider();
const result = await provider.materialize("local:/workspaces/consumer-project");
const status = await provider.status(result.location.path);

if (status.dirty || status.untracked) {
	console.log(status.untrackedPaths);
}
```

`materialize()` validates that the path exists and returns `action: "linked"`.
`status()` reports `clean`, `dirty`, `untracked`, and `untrackedPaths` when the
path is inside a git worktree. Non-git directories are valid local sources and
report `clean: undefined`.
