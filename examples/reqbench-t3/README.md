# reqbench-t3 — the analyst's requirements bench (T3)

A per-work POC app: its own CLI (`dgk`), extending the
multi-surface substrate for **one persona** — a requirements analyst. Presented in
**result mode**: the analyst runs a verb and gets a finished product, never the machine.
Set `DGK_COMMAND` to run this example under a white-label executable name.

> **O que isto prova — livro-razão de evidências:** ver [`EVIDENCE.md`](./EVIDENCE.md) — JSON-LD servido,
> histórico/diff e gate de publicação marcados **REAL**, e os limites honestos (a cadeia de hash é FNV-1a
> 32-bit, **não** sha256; `--live` é smoke de artefato único; sem validação de interop JSON-LD).

## What it demonstrates

The T3 chain, end to end, from the analyst's chair:

```bash
dgk source discover                       # which systems can I access?
dgk source pull web:reqbench-alm          # scrape one into a local snapshot
dgk records enrich                        # add domain fields (dry-run)
dgk records correct record:req-cadastro reviewed --apply   # promote a review
dgk requirements                          # read the requirements MOC (the product)
dgk requirements-search "nota fiscal"     # find requirements by text (--tipo/--sistema)
dgk requirements-health                   # audit the corpus: orphans, duplicates, dangling links
dgk actions --json                        # selectable multi-surface actions
dgk serve                                 # the same verbs on a web surface
```

`requirements` renders a navigable **Map of Content** (Obsidian markdown) grouped by
review state — the analyst's product. A correction persisted via `records correct` shows
up in it, because the persona view reads the same records state.

`requirements-search <query>` finds requirements across the corpus (frontmatter, body, and
section text) through the SAME sovereign vault surface that routes them — the query is data the
surface interprets, `--tipo`/`--sistema` scope it to a facet. `requirements-health` is the
corpus-level audit note-gates can't do: **orphans** (a requirement alone in the traceability
graph), **duplicates** (the same requirement ingested twice), and **dangling links** (a relation
to a requirement that doesn't exist). Traceability comes from the requirements themselves: the
live OSLC/RDF parse now extracts the ALM's link predicates (elaboratedBy / decomposedBy /
satisfiedBy / references …) as typed relations, so the graph and the health audit populate from
a real pull — not only the offline fixture.

The vault is **multi-source**: the analyst pulls from more than one ALM (the sample ledger ships
EFD and NFE), each requirement is stamped with its source `sistema`, and the taxonomy groups each
system's requirements into its own project area (`20 - Projects/EFD` vs `…/NFE`). A file
artifact's **attachment** (a diagram, a spreadsheet the Jazz RM requirement wraps) is downloaded
under a size/type policy, **materialized into the vault** at a content-addressed path
(`attachments/<hash>.<ext>`), recorded as a typed `RecordAttachment`, and **linked in the note**
(`[[attachments/…]]`) — so the materialized markdown carries the binary, instead of losing it.

The CLI persists local curation to `.dgk/requirements.manifest.json` by default, so a
correction made in one process is visible to the next command. Set
`DGK_REQUIREMENTS_STATE_PATH=/path/to/manifest.json` to record an isolated run.
Set `DGK_COMMAND=/path/to/cli-name` to change the CLI command root.

## Diagramas / material de registro

- [`diagrams/composition.svg`](diagrams/composition.svg) — arquitetura em camadas (app do analista + SDK genérico).
- [`diagrams/flow.svg`](diagrams/flow.svg) — a jornada do analista (múltiplos ALMs → puxar → organizar → materializar → analisar).

`dgk requirements-report --apply` materializa o material de registro em `.dgk/report/`: um
`report.md` com o estado do vault e os números reais (cobertura por sistema/tipo/status,
rastreabilidade, saúde, histórico) — alimenta a escrita, não é um painel decorativo.

## Running live (a real scrape)

Out of the box, `dgk requirements-pull web:efd` replays the **offline sample** in
`.dgk/sources.json` (so everything works and is testable without a network). `--live` scrapes a
**real** system.

### What `--live` does today — and does NOT (read this first)

**It does**: open your Chrome → you complete SSO/VPN login → it captures the session cookies →
it fetches **one OSLC resource URL** (the target's `url`) with the Jazz RDF contract → it parses
whatever requirements that one RDF document contains → into records → the MOC. It reuses the
cookie session across runs, and re-authenticates (a fresh browser login) if a pull hits a 401.

**It does NOT (yet)**: discover a project. It does **not** open a dashboard, list folders, walk
the artifact tree, paginate, or follow `/rm/links` to traverse the requirement graph. So it
pulls the artifact(s) in the URL you point at — **not a whole project**. Pointing `url` at a
dashboard/collection URL will return an HTML shell, not RDF, and yield **zero** records. This is
a build-it gap (the discovery/walk machinery isn't written), not a config knob. Treat `--live`
today as a **single-artifact OSLC smoke test** of the login → authenticated-GET → parse → record
chain.

### Steps

1. **Declare your system** in `.dgk/sources.json`. For a live run, `url` must be a single OSLC
   **resource** and `attributes.streamURI` is **required** (it becomes the OSLC
   `Configuration-Context` header — without it a config-managed component GET is unscoped and
   usually 400s). The host of `url` must be your real ALM and **not** a private/VPN IP
   (`10.x`/`192.168.x`/`.local` are egress-blocked; a real hostname like `alm.serpro` is fine):

   ```json
   {
     "targets": [
       {
         "identity": "efd",
         "url": "https://alm.serpro/rm/resources/<a-real-artifact-id>",
         "session": { "kind": "authenticated", "principal": "you" },
         "attributes": { "streamURI": "https://alm.serpro/rm/cm/stream/<real>" }
       }
     ]
   }
   ```

2. **Point at your Chrome** and a session directory, then pull live (connect the VPN first):

   ```bash
   export DGK_CHROME_PATH="/path/to/google-chrome"   # your installed Chrome (puppeteer downloads none)
   export DGK_SESSION_DIR="$HOME/.dgk/session"        # persistent profile + cookies
   # DGK_HEADLESS unset — must be headful to see/scan the SerproID QR in the window
   dgk requirements-pull web:efd --live
   dgk requirements                                   # then read the MOC
   ```

   A browser opens; complete **VPN + SSO** (scan the QR shown *in the browser window*). Login is
   **auto-detected** — once you're through, cookies are captured, persisted to
   `$DGK_SESSION_DIR/auth-state.json`, and reused next run.

### Calibrating login detection (no recompile)

The default "you're logged in" signal is: the URL left the login flow (not matching
`login|sso|auth|signin`) **and** contains the ALM host. Real SSO chains can fool this — it can
fire too early on an auth interstitial that's already on the ALM host, or hang if a post-login
URL contains `auth`/`sso` in its path. Tune it from the environment:

| Env var | What it does |
| --- | --- |
| `DGK_LOGIN_URL_INCLUDES` | Success only when the URL contains this substring (e.g. a dashboard path like `/rm/web`). |
| `DGK_LOGIN_READY_SELECTOR` | Success only when this CSS selector is present (a dashboard element shown only when authed). |
| `DGK_LOGIN_COOKIE` | Success only when a cookie of this name is set (the Jazz session cookie, e.g. `JSESSIONID`). |
| `DGK_LOGIN_URL_PATTERN` | Regex of "still logging in" URL fragments (default `login\|sso\|auth\|signin`) — narrow it if a real authed URL contains one of those. |
| `DGK_LOGIN_TIMEOUT_MS` | How long to wait for login, ms (default 180000). Raise for a slow VPN/SSO. |

Most reliable combo for Jazz: set `DGK_LOGIN_COOKIE=JSESSIONID` (or your real session cookie)
so success keys on the cookie actually being set, not just the URL.

### Troubleshooting

- **Hangs ~3 min then `BROWSER_LOGIN_TIMEOUT`** — the URL-pattern false-negative. Set
  `DGK_LOGIN_URL_INCLUDES` to a path that only appears once you're in, or `DGK_LOGIN_COOKIE`.
- **`EGRESS_DENIED`** — `url`'s host is a private/VPN IP; use the real ALM hostname.
- **OSLC GET 400/401 or zero records** — missing/wrong `streamURI`, or `url` points at a
  collection/dashboard (not a `/rm/resources/<id>`), or login captured cookies too early
  (calibrate the signal above).
- **`BROWSER_DRIVER_UNAVAILABLE`** — `puppeteer-core` (an optional dep) didn't install; run
  `pnpm add puppeteer-core` in this example and set `DGK_CHROME_PATH`.

The browser mechanism is the framework's (`@refarm.dev/browser-driver`) — any work, or an agent
operator, reuses it. Only the OSLC glue (the RDF request + parser) is specific to this example.
Without `--live` (or a Chrome) the offline fixture path runs; `--live` on a browserless build
says so, it doesn't fail silently.

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
4. **enriching** (the analyst's domain rules tag a requirement from its text — the
   generic `enrichment:v1` engine driven by the analyst's own ruleset),
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
