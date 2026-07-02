---
"@refarm.dev/ds": minor
---

ds-tokens:v1 semantic token contract: scoped themes (tractor-green + oceano/terracota/verde-jardim), conformance suite, and headless component classes. Publish typed `./contract` and `./theme-conformance` subpaths for consumers that want the contract helpers without relying on the root barrel.

Expose product-neutral CSS contract aliases for downstream consumers: prefer
`data-ds-theme`, `--ds-*`, `.ds-*`, `data-ds-scroll-region`, and `@layer ds.*`
while retaining the previous Refarm-prefixed selectors and variables as
compatibility aliases for current Refarm apps.
