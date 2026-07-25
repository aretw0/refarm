# refarm.shop — a sovereign commerce surface, cultivated from blocks

> Status: design (2026-07-25). Operator direction: help a friend's candy shop (doceria) with a
> PUBLIC site — products + prices + a "buy" button that opens WhatsApp (`wa.me`, her number + a
> personalized message from a sales form). Reduce the vault-seed idea to this; track orders the
> cheapest, most practical way. And: "talvez estejamos falando de uma nova parte do refarm que
> ainda não foi inaugurada… refarm.shop? Igual refarm.dev/.me/.social." **Yes — this inaugurates a
> fourth domain.**

## The domain (why it's a new surface, not a bolt-on)

Refarm today cultivates three surfaces (`docs/NAMING_REGISTRY.md`, `docs/ARCHITECTURE.md`):
`refarm.dev` (Factory Floor / dev+infra), `refarm.me` (Sovereign Identity / personal), `refarm.social`
(The Village / public gardens + feeds). **There is no commerce surface** — a repo-wide grep for
`commerce`/`catalog`/`cart`/`checkout`/`payment`/`pix`/`.shop` returns zero. Selling is a distinct
concern from gardening or feeds, so it earns its own domain: **`refarm.shop`** — the surface where a
sovereign seller publishes a catalog and takes orders on their own terms (no marketplace rent).

The doctrine is the one vault-seed already proved (`docs/VAULT_SEED_CONVERGENCE.md`):
**Refarm supplies the blocks; the shop composes the product.** What stays at the consumer edge is
the shop's own content (products, prices, copy, the seller's number). The generic machinery
(catalog, wa.me link, form-to-message, lead capture, the site generator) lives in `packages/` under
`@refarm.dev/*`. Readiness gate, verbatim from the convergence doc: *"Refarm is its own first
consumer. A block is supplyable only after Refarm consumes it itself."*

## First real case: the doceria (test raiz)

A friend's candy shop is the perfect first rope-stretch — prove it in a real life before
generalizing. Its shape is minimal and reveals exactly the blocks refarm.shop needs:
- a **product catalog** (name, price, image, maybe a short description);
- a **static site** that renders the catalog + a small quantity form;
- a **"buy on WhatsApp" button** that opens `wa.me/<her number>?text=<the order, prefilled>`;
- **order tracking** that is practical and cheap.

### Order tracking — no paid database (the operator's explicit question)

Researched; the answer is **you don't need to pay for a database**:
1. **MVP, zero backend:** `wa.me` links carry the order into her WhatsApp. The free **WhatsApp
   Business app** gives labels + statistics to count and organize orders (they arrive as chats).
2. **Click counts (optional):** a privacy-light client analytic (Plausible-style) or UTM params on
   the buy button — how many clicked, on which sweet. No database.
3. **Structured order log (optional, later):** a free-tier serverless KV (Cloudflare Workers KV =
   1k writes/day free, ample for a small shop) or a Google Form → Sheet. Free within limits.
   A paid store only if she ever wants order data OUTSIDE WhatsApp at scale.

## The substrate that EXISTS (reuse, don't reinvent)

- **`@refarm.dev/ds/html`** (`packages/ds/src/html.ts`) — the strongest fit: build-free static-HTML
  helpers (`documentHtml`, `gridHtml`, `cardHtml`, `fieldHtml`, `buttonHtml`, `footerHtml`). A
  products page is `gridHtml(products.map(cardHtml))` + a `fieldHtml` form. Caveat: `buttonHtml`
  emits `<button>`, not `<a href>` — the buy button needs an anchor (small addition, below).
- **`@refarm.dev/ds`** — design tokens/themes; **`@refarm.dev/ds-astro`** — `Card.astro` already
  models a product-card shape (`title`, `rows`, `actionsHtml`).
- **`@refarm.dev/content-projection` + `records-contract-v1`** — project Markdown/frontmatter into a
  generic `records:v1` model, if products are authored as files.
- **`generators/vault-seed/`** (`generate.mjs` + `manifest.json` + codemods) — the proven template
  generator pattern a future `generators/shop` copies.

## The MISSING blocks (named)

1. **`@refarm.dev/wa-link`** — the wa.me deep-link + form-to-message builder. **DONE (2026-07-25):**
   `buildWaLink`, `fillTemplate`, `orderLink`, `normalizePhone`; pure, zero-dep, browser+Node, 5
   tests. The first block of this surface. (Note: the only prior WhatsApp-aware code in the whole
   repo was buried in `packages/homestead` — see the audit below.)
2. **`@refarm.dev/catalog-contract-v1`** — the product/price data model: `Product { id, name, price,
   currency, image?, description?, available?, variants? }`, `Catalog`, and a pure validator. The
   commerce core; nothing shaped like it exists (`records-contract-v1` is unshaped).
3. **A form → message block** — a small form-schema + "assemble the order text from answers" (feeds
   `wa-link`'s `orderLink`). Partly covered by `wa-link.fillTemplate`; the form-schema + client
   serialize is the gap.
4. **A lead/analytics block** — a thin, backend-optional click/lead counter (the wa.me button
   click), so a shop can see interest without a paid store. Greenfield.
5. **The surface itself** — register `refarm.shop` in `NAMING_REGISTRY.md`/`ARCHITECTURE.md`; a
   `generators/shop/` template (catalog + `ds/html` render + wa-link buy button); optionally an
   `apps/shop` reference (the doceria as the first generated instance, its content at the edge).

## Domain-hygiene audit (blocks that may be misplaced)

The operator suspected some blocks live in the wrong domain. Findings (from the survey):
- **`packages/homestead/src/sdk/conversation-time.ts`** (+ `chat-composer*`, `Herald`, `Firefly`) —
  generic chat/messaging basics ("every chat has… Telegram/WhatsApp") inside **Homestead**
  (`refarm.me`). Chat/federated messaging is a **`refarm.social`** concern. This is also **the only
  WhatsApp-aware code in the repo** — the primitive a shop needs was hiding in the personal shell.
  Recommend: extract the messaging/deep-link concept toward a social/shop-shared block (`wa-link`
  now begins that).
- **`packages/wallet` (`@refarm.dev/wallet`)** — a `refarm.me` (Sovereign Identity) capability, but
  npm-scoped `@refarm.dev`. Not an accident: **ADR-069 closed the npm scope to `@refarm.dev` for all
  blocks**, so **block *domain* ≠ npm *scope*.** Worth stating explicitly so future surfaces don't
  confuse the two (refarm.shop blocks will also be `@refarm.dev/*`).
- **`apps/dev`** — named `@refarm.dev/app` but is "Refarm Studio"; `apps/site/README.md` itself says
  Studio should move to `studio.refarm.dev`, leaving `apps/site` to own the public `refarm.dev` IA.
  Acknowledged surface misplacement (not this spec's job, but noted).

## Release / handoff (this feeds the 0.1.0 question)

Reuse vault-seed's exact machinery: the `release:vault-seed:handoff` pipeline →
`.refarm/handoff/<consumer>/<date>/manifest.json` (sha256 + per-block consumer proofs + an
acceptance gate). **refarm.shop becomes the SECOND consumer of that handoff pipeline** — which,
per the convergence doc, is precisely what raises a block's promotion bar and validates it as
genuinely reusable (not vault-seed-shaped). So building the doceria also hardens the release story.

## Build slices (each atomic; blocks generic in packages/)

1. `@refarm.dev/wa-link` — **DONE**.
2. `@refarm.dev/catalog-contract-v1` — product/price contract + validator (pure, tested).
3. Add an **anchor button** to `ds/html` (`linkButtonHtml`/`buttonHtml` variant emitting `<a href>`)
   so the buy button is a drop-in — the one near-miss the survey found.
4. `generators/shop/` — a template that renders a catalog (`ds/html` + `ds-astro`) with wa-link buy
   buttons; the doceria is the first generated instance (content at the edge).
5. Lead/analytics block (optional MVP+).

## Non-goals (v1)

No payment processing, no cart/checkout state, no marketplace, no owned order database (the seller's
WhatsApp is the order book). Those are later surfaces if a shop outgrows wa.me.
