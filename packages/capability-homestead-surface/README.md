# @refarm.dev/capability-homestead-surface

The capability → Homestead web bridge (ADR-085).

A capability registry declares verbs with `renderers.web`; this projects the **web
face** of the neutral `surfaceModel` into a real Homestead surface plugin — the panel
a verb lights up in the Astro/Homestead shell (`apps/me`, `apps/dev`) from its one
declaration, no hand-rolled HTML renderer.

It closes the web follow-on left when `serveWebUi` was removed: the web is Astro +
Homestead, and this is how a verb reaches it. The bridge lives in its own package
because it needs BOTH `@refarm.dev/cli` (to read `renderers.web`) and
`@refarm.dev/homestead` (to mount) — a dependency Homestead itself must not take.

```ts
import { createCapabilityWebSurfacePlugin } from "@refarm.dev/capability-homestead-surface";

const handle = createCapabilityWebSurfacePlugin(registry, { slot: "main" });
// register `handle` with a Homestead host; the registry's web verbs appear as a panel.
```
