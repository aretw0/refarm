# @refarm.dev/homestead-ssr

Build-free Homestead SSR helpers for server-rendered Refarm surfaces.

This package exposes pure HTML-string helpers and a document shell that emit
`@refarm.dev/ds` classes. It intentionally does not import the bundled
`@refarm.dev/homestead` SDK, browser runtime, Tractor, storage, sync, Astro, or
custom-element code.

```ts
import { cardHtml, shellHtml } from "@refarm.dev/homestead-ssr";

const bodyHtml = cardHtml({
	title: "Vault",
	rows: ["<p>Ready</p>"],
});

const html = shellHtml({
	title: "Admin",
	theme: "verde-jardim",
	bodyHtml,
});
```

