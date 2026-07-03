# @refarm.dev/ds-astro

Astro and MDX bindings for `@refarm.dev/ds`.

This package is intentionally thin: it exposes product-neutral `.astro`
components that carry DS CSS imports and DS class names, while `@refarm.dev/ds`
stays framework-agnostic.

```astro
---
import Card from "@refarm.dev/ds-astro/Card.astro";
import MetricStrip from "@refarm.dev/ds-astro/MetricStrip.astro";
---

<Card title="Release proof">
	<p>Reusable MDX content can use sanctioned DS blocks.</p>
</Card>

<MetricStrip metrics={[{ label: "proofs", value: "3" }]} />
```

Consumers that generate MDX component maps can import `mdxComponents` from the
package root. The values are stable package subpaths:

```ts
import { mdxComponents } from "@refarm.dev/ds-astro";
```

## Boundary

- Depends on `@refarm.dev/ds`.
- Peer depends on `astro`.
- Does not depend on app packages, `homestead`, `vault-seed`, or private POC
  code.
- Product-specific vocabulary remains downstream.
