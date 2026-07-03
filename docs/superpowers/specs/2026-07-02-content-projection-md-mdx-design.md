# Content-projection (MD/MDX) blocks — design

> Graduates the `docs/research/2026-07-02-content-projection-blocks-md-mdx.md` direction (flagged by the
> vault-seed consumer) into an actionable design. Authoring content in Markdown/MDX and projecting it into
> `records:v1` is currently re-implemented downstream; it is a set of reusable blocks that belong in refarm
> so any consumer (vault-seed, `apps/site`, POCs) authors in MD/MDX without rebuilding the pipeline.

## Goal

Ship two generic, distributable blocks so a consumer authors content in MD/MDX and gets `records:v1` +
sanctioned UI composition without reimplementing the pipeline:

1. **`@refarm.dev/content-projection`** — a projection block over `records-contract-v1` (files/items →
   `records:v1`), composing with `source-local` (or any `source-*`) for acquisition.
2. **`@refarm.dev/ds-astro`** — the sanctioned MDX embed set: thin Astro components over `ds/html`, so MDX
   content composes the design system rather than arbitrary JSX. The `ds` core stays framework-agnostic.

## The reframe (why these boundaries)

"Support MDX" is not a site toggle (`@astrojs/mdx`). Authoring content is a pipeline:

```
source files (.md / .mdx)
  → parse frontmatter            (structured fields)
  → extract + resolve wikilinks  (relations, by id)
  → project to records:v1        (folder/type, fields, relations)
  → render (surfaces: page, graph, table — already views over records:v1)
```

Two design facts from the existing codebase set the boundaries:

- **The `source-*` family names by acquisition locus** (`source-web`/`source-git`/`source-local` = *where*
  the bytes come from), not by format. Acquiring a file tree is already `source-local`. So the MD/MDX work
  is not a new source — it is **projection** (a format → `records:v1`), orthogonal to acquisition. This
  mirrors the existing `records-contract-v1/yaml` codec: transforming a representation into records is a
  layer over the records contract, not a source adapter. (Naming it `source-content` would collide with
  Astro's Content Layer — Astro's "content" *is* the loader/acquisition abstraction the `source-*` family
  already occupies.)
- **The `ds` package is framework-agnostic HTML-string SSR + CSS** (`ds/html` helpers, `ds/lint`, tokens/
  themes) — there is no JSX/Astro component surface in the ecosystem yet. MDX embeds *components*, so the
  embed set is a **thin Astro binding over `ds/html`**, isolated in its own package so the `ds` core keeps
  the agnosticism that `homestead`/SSR depend on. Astro is a peerDependency of `ds-astro` only.

## Unit 1 — `@refarm.dev/content-projection`

A pure TypeScript block (mirrors the shape of the contract packages; reuses `records-contract-v1` for the
output envelope; **no new contract**). The body-format (MD vs MDX) is irrelevant to projection — frontmatter
and wikilinks are identical; MDX only adds embedded components, which are a render-time concern (Unit 2).

**Exports (pure, small, independently testable):**

- `parseFrontmatter(text) → { data, body }` — structured fields + body split.
- `extractWikilinks(body) → WikiLink[]` — link targets from the body.
- `resolveWikilinks(links, index) → Relation[]` — targets → relations by id (drop dangling/self), against a
  caller-supplied id index.
- `projectContentToRecords(items, config) → Record[]` — config-driven projection: `folder → @type`,
  `frontmatter keys → fields`, `wikilinks → relations`. `config` is the source's own declaration (the same
  shape as the vault.config manifest: folder/type map, which frontmatter keys become fields).

**Contract reuse:** the produced records validate against `records-contract-v1`; the block ships a small
validation/conformance helper asserting its output conforms (so a broken projection fails loudly).

**Dependency direction:** `content-projection` depends on `records-contract-v1`. It does **not** depend on
any `source-*` package — acquisition is the consumer's choice (compose with `source-local`, or feed items
from anywhere).

## Unit 2 — `@refarm.dev/ds-astro`

The sanctioned MDX embed set: thin `.astro` components wrapping `ds/html` render helpers (e.g. Button, Card,
Table) that guarantee the DS CSS is present, plus an `mdx-components` mapping so `@astrojs/mdx` resolves MDX
elements/components to this set.

- **Boundary preserved:** `@refarm.dev/ds` stays framework-agnostic (HTML strings + CSS). `ds-astro`
  peer-depends on `astro` and depends on `ds`; it is the *only* place the framework coupling lives.
- **"Components are the design system":** MDX authors compose `ds-astro`, not arbitrary JSX — the embed set
  is the DS, so authored content stays first-class and consistent by construction.
- **Guardrail-compatible, not guardrail-owning:** the DS composition guardrail (separate research/
  graduation, `docs/research/2026-07-02-ui-composition-guardrails.md`) is **out of scope here**; the embed
  set must merely be compatible with it (renders DS-tokened, lint-clean HTML).

## The philosophy, encoded

The consumer's rule — **MD → MDX → Astro, stepping up only when the previous can't express it** — becomes
executable: MDX embeds only `ds-astro` (the sanctioned set). Pure content stays MD; content needing a little
structure/interactivity steps to MDX + DS components; a full `.astro` component is the last resort.

## Data flow

```
source-local (acquire .md/.mdx files)
  → content-projection: parseFrontmatter → extract/resolveWikilinks → projectContentToRecords
  → records:v1
  → surfaces (page / graph / table — already views)

.mdx body: embedded components resolve to ds-astro (sanctioned embed set) at render time
```

## Acceptance (dogfood gate)

refarm proves it on its own consumer, minimally:

1. **`apps/site` authors ≥1 `.mdx` page** that composes a `ds-astro` component and whose frontmatter/body
   projects through `content-projection` to a valid `records:v1` record. This is the gate — **not** a full
   site migration. (The 579-line `index.astro` is the standing signal that content belongs in MD/MDX, but
   migrating it is downstream adoption, not this plan.)
2. **Downstream proof (follow-on, not blocking):** vault-seed converges its
   `generate_vault_data`/`noteToRecord`/`resolveLinks` onto `content-projection` — the second-consumer proof
   that retires the downstream reimplementation.

## Testing

- **`content-projection`:** unit tests per pure helper (frontmatter split; wikilink extraction; resolution
  dropping dangling/self; projection folder→type / frontmatter→fields / links→relations); an output-validates-
  `records-contract-v1` conformance test. Mirrors the `source-web` / contract-package test style.
- **`ds-astro`:** each component renders the expected `ds/html` output + asserts the DS CSS hook is present;
  a smoke test that a fixture `.mdx` composes the components and renders.

## Out of scope (YAGNI)

- The DS composition guardrail (its own research → plan).
- Full `apps/site` rewrite (one proof page is the gate).
- A new `source-*` adapter (acquisition is `source-local`; projection is orthogonal).
- A new contract package (reuses `records-contract-v1`).

## Anchoring (so it does not orphan)

The research doc is currently referenced nowhere else in refarm. On landing this design, link the research +
this spec from `docs/REFARM_WORK_FOCUS.md` and `docs/CONVERGENCE_ROADMAP.md`, and note the vault-seed
convergence in `docs/VAULT_SEED_CONVERGENCE.md`, so the graduation is tracked, not lost.

## Build phases (for the implementation plan)

1. **`@refarm.dev/content-projection`** — the projection block (foundation; buildable/testable alone).
2. **`@refarm.dev/ds-astro`** — the sanctioned MDX embed set.
3. **MDX wiring + acceptance** — the `@astrojs/mdx` integration + `mdx-components` mapping, the `apps/site`
   `.mdx` proof page, and the anchoring edits.

## References

- Research: `docs/research/2026-07-02-content-projection-blocks-md-mdx.md`
- Sibling research (out of scope, must stay compatible): `docs/research/2026-07-02-ui-composition-guardrails.md`
- Pattern templates: `packages/source-web` (source-family adapter), `records-contract-v1/yaml` (codec layer
  over records), `packages/ds/src/html.ts` (agnostic SSR helpers), the `quality-contract-v1` plan (package
  scaffold + TDD cadence).
