# reqbench-t3 — the analyst's requirements bench (T3)

A per-work POC app: its own CLI (`dgk`), extending the
multi-surface substrate for **one persona** — a requirements analyst. Presented in
**result mode**: the analyst runs a verb and gets a finished product, never the machine.

## What it demonstrates

The T3 chain, end to end, from the analyst's chair:

```bash
dgk source discover                       # which systems can I access?
dgk source pull web:reqbench-alm          # scrape one into a local snapshot
dgk records enrich                        # add domain fields (dry-run)
dgk records correct record:req-cadastro reviewed --apply   # promote a review
dgk requirements                          # read the requirements MOC (the product)
dgk actions --json                        # selectable multi-surface actions
dgk serve                                 # the same verbs on a web surface
```

`requirements` renders a navigable **Map of Content** (Obsidian markdown) grouped by
review state — the analyst's product. A correction persisted via `records correct` shows
up in it, because the persona view reads the same records state.

The CLI persists local curation to `.dgk/requirements.manifest.json` by default, so a
correction made in one process is visible to the next command. Set
`DGK_REQUIREMENTS_STATE_PATH=/path/to/manifest.json` to record an isolated run.

## Two layers

- **Generic (platform, unchanged):** `source` / `records` / `vault` — the neutral chain
  (discover → pull → enrich → correct → analyze → vault). None of it knows about
  requirements, ALM, or EFD.
- **Specific (this app):** `src/fixture.ts` holds the analyst's own systems + records;
  `src/persona.ts` declares the `requirements` verb, which **consumes the neutral
  `records analyze` envelope** and projects it into the requirements MOC. Swap this
  persona out and the neutral blocks are untouched — that's the white-label seam.

## Run it

```bash
pnpm --filter reqbench-t3 build
pnpm --filter reqbench-t3 dgk requirements
pnpm --filter reqbench-t3 dgk actions --json
# web surface:
pnpm --filter reqbench-t3 dgk serve --port 4321
# → GET http://127.0.0.1:4321/capabilities/requirements/moc
# → GET http://127.0.0.1:4321/docs/openapi.json
```

## Focus — what T3 makes shine (survives our design conversation)

**Persona & mode.** The requirements analyst; **result mode** — the analyst reads a
finished product (a navigable requirements MOC), never the machine. T3 is "the work with
the most material to show."

**The scenario to record.** An analyst starting a personal or team vault from zero,
quickly, then:
1. **discovering the systems they can access** (`source discover`),
2. **scraping** one of them,
3. **promoting corrections** (`records correct`),
4. **enriching** (a CNPJ / external-registry lookup — the enrichment WASM provider),
5. reading the **requirements MOC** (Obsidian markdown) — and, as an extra, an **Astro**
   frontend over the scraped requirements (the equivalent of the SERPRO
   `modelo-de-repositorio-para-requisitos` mkdocs SSG, but Astro).

**The reference to assimilate: RCDC5.** T3 depends heavily on what rcdc5 did (cache:
`~/.cache/checkouts/github.com/aretw0/rcdc5`). Assimilate its real flow into reqbench:
the real systems (EFD / PPCF / IPI / DACON, from `rcdc5-routing.json`), its `packages`
(`scraper-playwright` → `rm-enrichment` → `rm-renderer` → routing into the vault), and
the analyst's day-to-day. The specifics (SERPRO login, ALM scraping, EFD/CNPJ) live
HERE, declared as extensions — platform/vault-seed only ever assimilate the GENERIC.

**The easter egg (hidden continuity T1 → T3).** The extension T1 shows being developed
is the one T3 uses here — a requirements renderer / an enrichment provider — used as if
it always existed. T3 does not dwell on it.

**What to build for a rich demo.**
- The full analyst chain from zero: discover → scrape → correct → enrich (CNPJ) → MOC.
- A richer enrichment (the CNPJ / registry lookup) as a WASM provider (the loaded
  extension, `createWasmEnrichmentProvider`).
- An Astro (or web-surface) frontend over the requirements — the "shows well" artifact.

**What stays generic (platform) vs specific (here).** The platform ships the neutral chain
(discover/pull/enrich/correct/analyze/vault) + the surfaces. This app supplies the EFD
systems, the CNPJ enrichment, the requirements MOC/Astro projection. Swap the domain,
keep the machine.
