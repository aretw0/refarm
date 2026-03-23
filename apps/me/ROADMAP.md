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

## v0.1.0 — Bootstrap

**Status**: 🚧 In progress (Gate 3)
**What "bootstrap" means**: Everything loads from the repo. No graph discovery.

### Deliverables

- [ ] `StudioShell` mounts with `HeraldPlugin` and `FireflyPlugin` in real DOM slots
- [ ] `HeraldPlugin` initializes: identity state legible (at minimum: `"unauthenticated"`)
- [ ] `FireflyPlugin` initializes: system notifications functional
- [ ] `BrowserSyncClient` connects to tractor (`ws://localhost:42000`), snapshot received
- [ ] At least 1 content plugin installable by explicit URL + SHA-256
- [ ] OPFS persistence: plugin cache survives page reload
- [ ] PWA manifest + Service Worker: offline-first confirmed
- [ ] Offline roundtrip: disconnect tractor → write mutation → reconnect → delta delivered

**What loads from the repo**: everything — layout, shell plugins, initial configuration.
**What loads from the graph**: nothing yet (empty OPFS on first boot).

### Acceptance

See [Gate 3b spec](../../docs/gate3-homestead-tractor-spec.md#gate-3b-reference-distro--appsme-the-actual-gate).

---

## v0.2.0 — Sovereign Mode

**Status**: 🔄 Planned
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

The transition from v0.1.0 bootstrap → v0.2.0 sovereign mode occurs when the user's
graph contains at least one `refarm:PluginRegistry` node. See
[distro-evolution-model.md](../../docs/distro-evolution-model.md#the-point-of-inflexion).

---

## v0.3.0 — Social & Discovery

**Status**: 🔄 Planned (post-sovereign)

### Deliverables

- [ ] Peer discovery via tractor LAN mDNS — find other Refarm instances on local network
- [ ] Plugin discovery via Nostr (NIP-89/94): Herald surfaces plugin suggestions from relay
- [ ] Publish `refarm:PluginRegistry` nodes to user's Nostr relay for sharing with peers
- [ ] Curated plugin feed: follow a peer → see their public plugin registry
