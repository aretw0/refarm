# reqbench-t3 — the analyst's requirements bench (T3)

A per-work POC app: its own CLI (`reqbench`), refarm underneath, extending the
multi-surface substrate for **one persona** — a requirements analyst. Presented in
**result mode**: the analyst runs a verb and gets a finished product, never the machine.

## What it demonstrates

The T3 chain, end to end, from the analyst's chair:

```bash
reqbench source discover                       # which systems can I access?
reqbench source pull web:reqbench-alm          # scrape one into a local snapshot
reqbench records enrich                         # add domain fields (dry-run)
reqbench records correct record:req-cadastro reviewed --apply   # promote a review
reqbench requirements-moc                        # read the requirements MOC (the product)
reqbench serve                                   # the same verbs on a web surface
```

`requirements-moc` renders a navigable **Map of Content** (Obsidian markdown) grouped by
review state — the analyst's product. A correction persisted via `records correct` shows
up in it, because the persona view reads the same records state.

## Two layers

- **Generic (refarm, unchanged):** `source` / `records` / `vault` — the neutral chain
  (discover → pull → enrich → correct → analyze → vault). None of it knows about
  requirements, ALM, or EFD.
- **Specific (this app):** `src/fixture.ts` holds the analyst's own systems + records;
  `src/persona.ts` declares the `requirements-moc` verb, which **consumes the neutral
  `records analyze` envelope** and projects it into the requirements MOC. Swap this
  persona out and the neutral blocks are untouched — that's the white-label seam.

## Run it

```bash
pnpm --filter reqbench-t3 build
pnpm --filter reqbench-t3 reqbench requirements-moc
# web surface:
pnpm --filter reqbench-t3 reqbench serve --port 4321
# → GET http://127.0.0.1:4321/capabilities/requirements/moc
```
