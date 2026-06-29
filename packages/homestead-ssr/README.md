# @refarm.dev/homestead-ssr

Build-free Homestead SSR helpers for server-rendered DS surfaces.

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

## Isomorphic: SSR is the primary use, not the only one

The render helpers (`@refarm.dev/homestead-ssr/render`) and the document shell
are pure, dependency-free HTML-string functions — they import no Node built-ins
(locked by `isolation.test.ts`). So beyond server-side rendering, a consumer can
serve `dist/render.js` to the browser and call the same `cardHtml` / `tableHtml`
/ … client-side, producing identical `@refarm.dev/ds`-classed markup on both
sides with no duplicate render logic. SSR is the headline use; the helpers are
not server-only.
