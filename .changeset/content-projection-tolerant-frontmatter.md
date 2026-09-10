---
"@refarm.dev/content-projection": patch
---

`parseFrontmatter` degrades to empty data when the frontmatter is not valid YAML instead of throwing, so one malformed file no longer aborts the projection of an entire vault. The raw block stays available in `frontmatter` for callers that want to inspect or report it.
