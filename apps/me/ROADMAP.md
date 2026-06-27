# refarm.me — Roadmap

**App**: `apps/me` (refarm.me)
**Role**: Sovereign citizen hub — the core distro for personal sovereignty
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)
**Evolution model**: [docs/distro-evolution-model.md](../../docs/distro-evolution-model.md)

---

## Architecture

`apps/me` is the **smallest meaningful Refarm distro**:

```
StudioShell (packages/homestead/sdk/Shell.ts)
  ├── HeraldPlugin  (Herald.ts) — identity & presence
  ├── FireflyPlugin (Firefly.ts) — system notifications
  └── [content plugins] — loaded from OPFS via installPlugin()

BrowserSyncClient (packages/sync-loro/) — WebSocket → tractor → OPFS
installPlugin()    (packages/tractor-ts/) — SHA-256 + OPFS cache
```

**No optional dependencies**: no sower, no scarecrow, no ds.
This is intentional — `apps/me` represents the sovereign citizen, not the developer.

---

## pi-era recalibration

This roadmap describes capability tracks for `apps/me`; it is not a promise to promote Refarm by version number. The current priority is making `apps/me` reliable enough to be the creator's personal daily-driver shell before any `v0.1.0` release is minted.

---

## Daily-driver bootstrap track (legacy `v0.1.0` bucket)

**Status**: 🚧 In progress (Gate 3)
**What "bootstrap" means**: Everything loads from the repo. No graph discovery.

### Deliverables

- [x] `StudioShell` mounts with `HeraldPlugin` and `FireflyPlugin` in real DOM slots
- [x] `HeraldPlugin` initializes: identity state legible (at minimum: `"unauthenticated"`)
- [x] `FireflyPlugin` initializes: system notifications functional
- [x] `BrowserSyncClient` connects to tractor (`ws://localhost:42000`), snapshot received
- [x] At least 1 content plugin installable by explicit URL + SHA-256
- [x] OPFS persistence: plugin cache survives page reload
- [x] PWA manifest + Service Worker: offline-first confirmed
- [x] Offline roundtrip: disconnect tractor → write mutation → reconnect → delta delivered

### Current evidence

- Identity bootstrap state is legible through both the `apps/me` personal Homestead surface and the shared `HeraldPlugin` status presentation (`"unauthenticated"` by default). Coverage: `me-surfaces`, runtime context handoff, and Homestead Herald status rendering tests.
- Firefly notifications are covered at the shared Homestead plugin level and through an `apps/me` runtime test that boots the real `FireflyPlugin` and renders a `system:alert` toast.
- The `apps/me` runtime now has a jsdom proof that boots the real `setupStudioShell`, `HeraldPlugin`, and `FireflyPlugin` against Homestead layout slots, mounts the personal surface in `main`, and keeps the loading boundary closed.
- `BrowserSyncClient` now has a package-level proof for the default tractor
  endpoint (`ws://localhost:42000`), local-state send on open, local delta
  forwarding, and received binary snapshot/update application.
- `apps/me` now wires `BrowserSyncClient` lifecycle/update events into runtime
  telemetry (`me:browser_sync`), including early events emitted before the
  Tractor handle is returned from boot. This makes the next browser/runtime
  proof observable without relying on console scraping.
- The personal Homestead surface now receives a host-owned `syncStatus` derived
  from those browser-sync events. A `remote-update-applied` event is surfaced as
  `snapshot-applied`, so the browser proof can assert DOM state instead of
  relying only on telemetry internals.
- Browser smoke coverage now boots `apps/me` in Chromium against the running
  Tractor daemon and asserts the rendered personal surface reaches
  `snapshot-applied`. Coverage: `pnpm -C apps/me run smoke:sync`.
- Plugin cache smoke coverage installs a SHA-256 pinned WASM through
  `@refarm.dev/tractor/browser`, reloads the page, and asserts the second
  install is an OPFS cache hit with no refetch. Coverage:
  `pnpm -C apps/me run smoke:plugin-cache`.
- Content plugin smoke coverage injects a SHA-256 pinned component URL plus
  browser runtime module URL before app boot, installs it through
  `@refarm.dev/tractor/browser`, activates it in the Registry, loads it through
  the browser `PluginHost`, and asserts its Homestead surface renders in the
  real app DOM. Coverage: `pnpm -C apps/me run smoke:content-plugin`.
- PWA smoke coverage serves the `apps/me` manifest and Service Worker, waits for
  the browser shell to become Service Worker controlled, reloads once to seed the
  cache, and then proves the personal surface renders while Chromium is offline.
  Coverage: `pnpm -C apps/me run smoke:pwa`.
- Offline roundtrip smoke coverage boots the real app against a browser
  WebSocket mock, disconnects sync, writes a local Loro-backed node through the
  workbench, waits for reconnect, and asserts the next sync payload contains the
  local mutation. Coverage: `pnpm -C apps/me run smoke:offline-roundtrip`.
- `sync-loro` now has a runtime transport smoke that connects to a running
  Tractor daemon at `ws://127.0.0.1:42000` and proves a non-empty initial binary
  snapshot reaches `BrowserSyncClient.applyUpdate`. This is still below the
  `apps/me` Gate 3b bar because it does not boot the browser app or prove OPFS
  projection.
- `installPlugin()` has focused `tractor-ts` coverage for URL fetch/cache,
  cache-hit, cache revalidation, SHA-256 accept/reject, missing integrity
  rejection, and hex/base64 sha256 forms.
- Shell test fixtures now match the real Homestead Layout slots (`logo`, `nav`, `main`, `streams`, `statusbar`) instead of a non-existent `header` slot.

### Remaining bootstrap proof

Gate 3b now has downstream `apps/me` proof for sync transport, plugin cache
persistence, explicit content plugin installation, offline-first PWA behavior,
and offline mutation/reconnect delivery. The remaining daily-driver work should
move from bootstrap proof to sovereign-mode mileage: graph-backed identity,
plugin registry discovery, plugin management UI, and multi-device sync. For the
release gate, one combined real-daemon observation still needs to assert that the
exact offline `apps/me` mutation appears in Tractor's read model after reconnect;
the app-level smoke currently proves delivery into the reconnect payload.

**What loads from the repo**: everything — layout, shell plugins, initial configuration.
**What loads from the graph**: nothing yet (empty OPFS on first boot).

### Acceptance

See [Gate 3b spec](../../docs/gate3-homestead-tractor-spec.md#gate-3b-reference-distro--appsme-the-actual-gate).

---

## Sovereign mode backlog (legacy `v0.2.0` bucket)

**Status**: 🔄 Planned after daily-driver bootstrap
**What "sovereign" means**: The distro reads the user's graph. Plugins are discovered, not hardcoded.

### Deliverables

- [ ] `HeraldPlugin` reads identity from the graph — Nostr key via `identity-nostr`
      (`world refarm-identity-plugin` WIT, commit `07f338b`)
- [ ] Distro checks graph for `refarm:PluginRegistry` nodes on boot
- [ ] Plugins discovered from registry → installed dynamically (no URL hardcoded in repo)
- [ ] First plugin management UI:
  - Install plugin by URL + SHA-256 hash
  - List installed plugins (from OPFS)
  - Remove a plugin
- [ ] Multi-device sync: mutations on device A appear on device B after tractor sync

**What loads from the repo**: shell plugins (Herald, Firefly) + layout base only.
**What loads from the graph**: plugin catalog, identity (Nostr key), user preferences.

### Inflexion point

The transition from bootstrap → sovereign mode occurs when the user's
graph contains at least one `refarm:PluginRegistry` node and the daily-driver shell remains reliable. See
[distro-evolution-model.md](../../docs/distro-evolution-model.md#the-point-of-inflexion).

---

## Social & discovery backlog (legacy `v0.3.0` bucket)

**Status**: 🔄 Planned (post-sovereign, post-daily-driver)

### Deliverables

- [ ] Peer discovery via tractor LAN mDNS — find other Refarm instances on local network
- [ ] Plugin discovery via Nostr (NIP-89/94): Herald surfaces plugin suggestions from relay
- [ ] Publish `refarm:PluginRegistry` nodes to user's Nostr relay for sharing with peers
- [ ] Curated plugin feed: follow a peer → see their public plugin registry
