# @refarm.dev/local-surface

Provider-neutral local surface helpers for POCs and downstream products that
need a simple browser surface without adopting Homestead.

Capability: `local-surface:v1`.

The package owns:

- a versioned `local-surface.v1` manifest;
- static DS-backed HTML rendering;
- a white-label launch plan for CLI wrappers;
- a deterministic DS quality snapshot and `quality:v1` report helper.

It does not start a server, persist data, choose a provider, render a product
brand, or replace Homestead. Consumers can wrap the manifest with their own CLI
labels, routes, storage adapters, and provider setup.

```ts
import {
	buildLocalSurfaceLaunchPlan,
	createLocalSurfaceManifest,
	renderLocalSurfaceDocument,
} from "@refarm.dev/local-surface";

const manifest = createLocalSurfaceManifest({
	id: "wallet-demo",
	title: "Local Wallet",
	description: "Review credentials, authorization receipts, and revocation.",
	storageNamespaces: ["credentials", "receipts"],
	panels: [
		{
			id: "credentials",
			title: "Credentials",
			summary: "Local credential records.",
			kind: "dataset",
		},
	],
	actions: [
		{
			id: "review-request",
			label: "Review Request",
			kind: "review",
			requiresReview: true,
		},
	],
});

const html = renderLocalSurfaceDocument(manifest);
const launchPlan = buildLocalSurfaceLaunchPlan(manifest, {
	commandLabel: "my-cli",
});
```
