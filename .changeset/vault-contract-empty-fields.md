---
"@refarm.dev/vault-contract-v1": patch
---

`recordToVaultNote` keeps a declared-but-empty field as `key:` instead of dropping the line. `undefined` is absence and is still skipped, but `null` is data — the field exists and is unfilled — and dropping it contradicted this renderer's own contract that "the KEY is always present (so a `frontmatter-required` gate sees it)". Applies inside block-style nesting too, so an item's empty `ean:` survives materialization.
