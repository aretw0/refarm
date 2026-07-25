# The hub's hybrid home — chat-centered, with a slim attention strip

> Status: design (2026-07-25). Operator feedback after opening `apps/me` on the phone: "estamos
> sem direção de UX, jogamos tudo em uma página aleatória… tá tudo muito capenga de intenção real
> de uso, tudo misturado." Chosen direction: **hybrid — the conversation is the home, with a slim
> attention strip on top.** This doc grounds the redesign so a fresh pass builds it right (and is
> validated on the operator's phone, once hub auth lands per ADR-093).

## The diagnosis (what's wrong today)

The current hub (`apps/me/src/pages/index.astro` + `src/lib/me-surfaces.ts`) renders a **debug
panel dressed as a product**: architecture prose ("rendered through the shared Homestead surface
contract with host context from apps/me"), internal counters (REGISTRIES 0, PLUGINS 0, DRIVER
PRIMITIVES 5), a leaked task ref (`T2-F7`), mixed English/Portuguese, and the chat — the one thing
the operator instinctively reached for — buried at the bottom. The root cause is not CSS: **we
never decided what the screen is FOR.** The surfaces were developer scaffolding proving the
render contract works; they became the face by default.

## The target

The phone hub is a **control plane in the pocket**, so its one job is: **talk to your farm and it
acts.** Everything else (identity, wallet, graph, status) is consequence-of-the-conversation or one
tap away — never a wall.

```
┌───────────────────────────────┐
│ 🚜 Refarm          ● sincronizado│  ← slim header: identity + a single sync dot
│ ⚠ 1 consentimento pendente   → │  ← attention strip: DISAPPEARS when there's nothing
├───────────────────────────────┤
│   você:  quem é você?          │
│   fazenda:  sou a sua...        │  ← THE CONVERSATION is the home
├───────────────────────────────┤
│ [ Pergunte à fazenda…      ] ▶ │  ← input always at hand
└───────────────────────────────┘
     ⋮  status · carteira · grafo    ← everything else, one tap away
```

## Component plan

- **Home = the conversation.** Promote the chat (`me-chat` + the message list + the input) from a
  bottom afterthought to the primary, full-height surface. It already works over the tunnel (the
  sidecar-API proxy fix, commit 960c150d).
- **Attention strip** (the "hybrid" half): a slim, dismissible bar above the conversation that
  surfaces 1–2 items that NEED the operator, derived from real state — pending wallet consents
  (`me-wallet` has the consent records), scheduled work due (`loadProjectScheduledWork`, already in
  index.astro), a sync problem. **Renders nothing when there's nothing** (never a permanent band).
  Tapping an item opens the relevant surface.
- **Everything else behind a tap.** The current surfaces (status, wallet, profile, graph) move out
  of the main scroll into a menu/sheet (a `⋮` or a bottom tab). `me-surfaces.ts` is not deleted — it
  stops being "the face" and becomes the content of "status", reached on demand. `workspacesFor`
  (from `@refarm.dev/workspace-access-contract-v1`) feeds a workspace picker here once auth lands.
- **Strip the developer scaffolding** from the product surface: the "surface contract"/"Studio app"
  prose, the raw counters, the `T2-F7`-style refs. Those belong in a dev/diagnostics view, not the
  home.

## i18n

The content mixes English headers ("PERSONAL SOVEREIGN SURFACE", "WALLET", "consent") with
Portuguese. Pick ONE surface language driven by a locale (the operator is pt-BR); keep identifiers
(capability ids, workspace ids) in their canonical form but translate all human-facing labels. A
small message catalog, not hard-coded strings, so the surface language is a setting.

## Boundaries / non-goals

- Keep it a FIRST cut that is clearly better than the debug panel; polish (animations, the full
  menu taxonomy) is iterative on the operator's phone.
- Reuse existing blocks — `me-chat`, `me-wallet`, `loadProjectScheduledWork`, the Homestead
  `Layout` (viewport/charset already correct). No new framework.
- Do NOT redesign the desktop Studio surface here; this is the phone/PWA home.

## Dependency

Phone validation of this needs the hub reachable safely from the phone — i.e., hub auth (ADR-093)
so a credential-gated tunnel can serve it without a public unauth exposure. Build the layout locally
first (astro build + `web serve`), then validate on the phone once ADR-093 lands.
