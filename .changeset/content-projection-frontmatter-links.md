---
"@refarm.dev/content-projection": minor
---

Add `extractFrontmatterWikilinks` and the opt-in `linkFrontmatter` config so projections can pick up the typed links Obsidian-style vaults keep in frontmatter values. Off by default, so existing consumers keep their exact relation sets. `parseFrontmatter` also stops emitting a per-file YAML process warning by parsing at `logLevel: "error"`, which silences warnings while keeping parse errors throwing so malformed blocks still degrade to empty data.
