---
"@refarm.dev/vault-contract-v1": patch
---

`recordToVaultNote` now quotes frontmatter scalars that YAML would otherwise retype. The case that matters in a knowledge vault is `[[Note]]`: written bare it is a nested flow sequence, so a materialized wikilink parses as `[["Note"]]` — it survives a diff and dies at parse. Indicator-leading scalars, `: ` / ` #` separators, surrounding whitespace, and boolean/null/number-shaped strings are covered too; unambiguous scalars stay bare.
