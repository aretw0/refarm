# @refarm.dev/content-projection

Markdown/MDX projection helpers for `records:v1`.

This package is not a source adapter and does not read files by itself. Consumers
can acquire bytes through `source-local`, `source-git`, `source-web`, or their
own loader, then pass content items here to produce neutral `KnowledgeRecord`
objects.

## Exports

- `parseFrontmatter(text)` splits YAML front matter from body text.
- `extractWikilinks(body)` extracts `[[target]]` and `[[target|label]]` links.
- `extractMarkdownLinks(body)` extracts inline `[label](target)` Markdown links.
- `extractExternalMarkdownLinks(body)` extracts external inline Markdown links
  for metadata preservation.
- `extractFrontmatterWikilinks(data)` extracts `[[target]]` links from anywhere
  in the frontmatter value tree — strings, arrays, and nested objects — tagged
  with the top-level key they came from. Obsidian-style vaults keep typed links there (`responsavel:
  "[[Arthur]]"`), and a body-only scan drops them silently. Enable it in
  `projectContentToRecords` with `linkFrontmatter: true`; it stays off by
  default so existing consumers keep their exact relation sets.
- `resolveWikilinks(links, index, options)` maps link targets to
  `records:v1` relations while dropping dangling and self links.
- `resolveMarkdownLinks(links, index, options)` maps local inline Markdown
  links to `records:v1` relations while dropping external, dangling, and self
  links.
- `projectContentToRecords(items, config)` maps content items to
  `KnowledgeRecord[]` using folder-to-type and frontmatter-to-field rules.
  External inline Markdown links are preserved as
  `content-projection:externalLinks` metadata because `records:v1` relations
  must target records in the same manifest.
- `validateProjectedRecords(records)` validates the projected output with the
  reference `records:v1` provider.

MD and MDX share this projection path. MDX components are a render-time concern
owned by a framework binding such as a future `ds-astro` package.
