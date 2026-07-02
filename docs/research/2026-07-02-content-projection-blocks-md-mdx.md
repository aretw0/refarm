# Content-projection blocks — MD (and MDX) → records:v1 as refarm primitives

> Direction/feedback from the vault-seed consumer. The machinery to author content in **Markdown** and
> project it into `records:v1` is currently re-implemented downstream (vault-seed). It is a set of reusable
> **blocks** that belong in refarm, so any consumer — vault-seed, `apps/site`, downstream POCs — authors in
> MD/MDX without rebuilding the pipeline. Generic; no domain specifics.

## The reframe

"Support MDX" is not a site toggle (`@astrojs/mdx`). Authoring content is a **pipeline of blocks**:

```
source files (.md / .mdx)
   → parse frontmatter            (structured fields)
   → extract + resolve wikilinks  (relations, by id)
   → parse body (MD, or MDX = MD + components)
   → project to records:v1        (folder/type, fields, relations, sections)
   → render (surfaces: page, graph, table — already views over records:v1)
```

records:v1 already owns the **envelope**. What is missing upstream is the **projection** (files → records)
and the **authoring** (MD/MDX) blocks. vault-seed built them for MD; they should be refarm primitives.

## What vault-seed already built for MD (the reference)

| vault-seed piece | The block it implies |
|---|---|
| frontmatter read (gray-matter) | `parseFrontmatter(text) → { data, body }` |
| `extractLinks` + `resolveLinks` (title/slug → id, drop dangling/self) | `extractWikilinks(body)` + `resolveWikilinks(links, index) → relations` |
| `noteToRecord` (folder→`@type`, frontmatter→fields, links→relations) | `projectContentToRecords(items, config) → records:v1` (config-driven, like the vault manifest) |
| the vault.config manifest (folders/status/vocab) | the projection **config** (a source's own declaration) |
| the graph / table surfaces | **already** views over records:v1 — no change |

The projection is already `records:v1`-shaped and config-driven downstream; extracting it upstream is
mostly relocation + generalization, not new design.

## Proposed refarm block: a content source

A `source:v1`-family **content/markdown source** (sibling of `source-web` / `source-git` / `source-local`):
it reads MD/MDX files and yields `records:v1` records via the projection blocks above. The parsing
primitives (`parseFrontmatter`, `extractWikilinks`, `resolveWikilinks`) are small, pure, testable, and
reusable independently.

- **Consumers converge:** vault-seed drops its `generate_vault_data`/`noteToRecord`/`resolveLinks` onto the
  refarm source (a downstream proof); `apps/site` and POCs get MD→records for free.
- **The projection stays config-driven** — each source declares its own rules (folder→type, which
  frontmatter keys become fields), exactly the vault.config manifest pattern.

## MDX = MD + components (the philosophy, in order)

The consumer's rule: **MD → MDX → Astro components, only stepping up when the previous can't express it.**

1. **MD** — pure content (frontmatter + body + wikilinks). The default; most portable/editable.
2. **MDX** — MD **plus embedded components**. The components are **DS components** (`@refarm.dev/ds`) — so
   MDX content composes the design system, not arbitrary JSX. This is the block for "content that needs a
   little interactivity/structure" without leaving the content layer.
3. **Astro component** — only when neither MD nor MDX can express it (heavy interactivity, layout logic).

**Implication for existing screens:** anything "far from MD" that *could* be MDX should be reconsidered.
(Downstream signal: vault-seed's site is today ~all heavy `.astro` — e.g. a 579-line `index.astro` — the
opposite of this order. Much of it is content that belongs in MD/MDX composing DS components.)

## The blocks to build (refarm)

1. `parseFrontmatter` — pure (frontmatter → fields + body).
2. `extractWikilinks` + `resolveWikilinks` — pure (body → link targets → resolved relations by id).
3. `projectContentToRecords` — config-driven MD/MDX-item → `records:v1` (folder/type, fields, relations).
4. A **content source** wiring 1-3 over a file tree (the `source:v1`-family adapter).
5. **MDX authoring:** the `@astrojs/mdx`-style integration wired to **DS components** as the sanctioned
   embed set — so MDX content composes `@refarm.dev/ds`, keeping the "components are the design system"
   boundary.

## Boundary

- refarm owns the projection + authoring blocks (generic); consumers declare their projection config and
  author their content. Same shape as records:v1 / the surfaces.
- The MDX embed set is the **DS** — not arbitrary components — so authoring stays first-class + consistent
  (this is where the UI composition guardrail and the DS meet the content layer).

## Flagged by

vault-seed (2026-07-02), recognizing that its MD-support machinery (frontmatter, wikilinks, projection) is
a set of reusable blocks stuck downstream, and that MDX is the same pipeline plus DS-component embedding —
both belong upstream so every consumer authors content the same way.
