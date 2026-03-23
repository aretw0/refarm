# refarm.dev — Studio Roadmap

**App**: `apps/dev` (refarm.dev)
**Role**: Sovereign IDE — web-based management interface and developer tooling
**Current Version**: v0.0.1-dev
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)
**Evolution model**: [docs/distro-evolution-model.md](../../docs/distro-evolution-model.md)
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## Overview

**Studio** is the web-based management interface for Refarm built with:

- **Astro** (SSG framework)
- **Lit** (Web Components)
- **TypeScript** (type safety)

**Responsibilities**:

- Visualize sovereign graph (d3.js/cytoscape.js)
- Manage plugins (install, configure, uninstall)
- Browse and edit data (JSON-LD inspector)
- Identity/profile management UI
- Dev tools (observability dashboard, logs, metrics)
- Settings and configuration

---

## Bootstrap Phases

> How `apps/dev` (refarm.dev) evolves from a static repo seed to a sovereign IDE.
> See [distro-evolution-model.md](../../docs/distro-evolution-model.md) for the full model.

### Bootstrap (pre-v0.5.0)

`refarm.dev` does not exist yet as a user-facing app. This phase is kernel/tractor focus.

- Shell plugins (Herald, Firefly) are defined but not yet wired to a Studio UI
- IDE plugins (sower, scarecrow, ds) exist as packages, not in a distro
- Tractor graduated (ADR-048) and Gate 3 validates end-to-end sync via `apps/me`
- **What loads from the repo**: `apps/me` is the reference distro during this phase

### Sovereign IDE (v0.5.0+)

Studio first ships. The architecture is graph-aware from the start — not bolted on later.

- Shell plugins as npm dependencies (Herald, Firefly)
- IDE plugins baked-in: sower, scarecrow, ds
- BrowserSyncClient connects to tractor (`ws://localhost:42000`) — sovereign graph in OPFS
- Plugin marketplace reads `refarm:PluginRegistry` from the developer's graph
- **What loads from the repo**: shell + base IDE plugins + layout
- **What loads from the graph**: developer's plugin registry, project configurations

### Graph Visualization (v0.7.0 → v1.0.0)

The developer can see and inspect their sovereign graph directly within Studio.

- v0.7.0: interactive graph visualization (d3/cytoscape, pan/zoom, node inspection)
- v1.0.0: production-quality graph browser; inspect `refarm:PluginRegistry` nodes,
  project nodes, and identity nodes as first-class UI
- **What loads from the graph**: same as Sovereign IDE, plus graph visualization data

---

## v0.5.0 — Studio: Sovereign IDE MVP

**Scope**: Initial Studio UI with core management features, graph-aware from day one
**Status**: Deferred (begins after Gate 3)
**Depends on**: Gate 3 complete (`apps/me` pairing with tractor validated)

### SDD (Spec Driven)

**Goal**: Define Studio architecture and UI components
**Gate**: Specs complete, peer reviewed, no TODOs

- [ ] ADR-014: Studio architecture (Astro + Lit)
- [ ] ADR-015: State management (Lit reactive controllers)
- [ ] ADR-016: Routing strategy (Astro file-based + client-side)
- [ ] Spec: Studio ↔ tractor integration
  - [ ] BrowserSyncClient wiring (sovereign graph → OPFS → Studio state)
  - [ ] Query pattern (read from OPFS-backed SQLite)
  - [ ] Real-time updates (Loro deltas → reactive Lit components)
- [ ] Spec: Component library
  - [ ] Layout components (header, sidebar, main)
  - [ ] Data display (JSON-LD viewer, tables, cards)
  - [ ] Forms (inputs, buttons, validation)
  - [ ] Navigation (routing, breadcrumbs)
- [ ] Spec: Accessibility compliance (WCAG 2.2 AA)
  - [ ] Semantic HTML + ARIA
  - [ ] Keyboard navigation
  - [ ] Focus management
  - [ ] Color contrast

### BDD (Behaviour Driven)

**Goal**: Write integration tests that describe expected behavior (FAILING)
**Gate**: Tests written (🔴 RED), peer reviewed

- [ ] E2E: User opens Studio, sees dashboard
- [ ] E2E: User navigates between pages (keyboard + mouse)
- [ ] E2E: Studio connects to tractor, sovereign graph loaded
- [ ] E2E: User installs plugin via UI (URL + SHA-256)
- [ ] E2E: User browses JSON-LD data from OPFS
- [ ] E2E: All interactions are keyboard-accessible
- [ ] Acceptance: Studio provides full Refarm management capability

### TDD (Test Driven)

**Goal**: Write unit tests for contracts (FAILING)
**Gate**: Tests written (🔴 RED), coverage ≥80%

- [ ] Unit: Lit component rendering
- [ ] Unit: OPFS data access (via storage-sqlite)
- [ ] Unit: Route generation (Astro)
- [ ] Unit: State management (reactive controllers)
- [ ] Unit: Form validation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

**Goal**: Implement code until all tests PASS
**Gate**: Tests GREEN (🟢), coverage met, changeset created

- [ ] Domain: Astro pages (index, plugins, data, settings)
- [ ] Domain: Lit component library (30+ components)
- [ ] Domain: BrowserSyncClient integration (Studio ↔ tractor)
- [ ] Domain: State management layer (graph-reactive)
- [ ] Infra: Astro configuration (SSG, i18n, routes)
- [ ] Infra: Lit Element integration
- [ ] Infra: astro-i18next (pt-BR, en, es)
- [ ] Asset: Design system (colors, typography, spacing)

### CHANGELOG

```
## [0.5.0] - YYYY-MM-DD
### Added
- Studio MVP with core management UI
- Plugin management interface (install by URL + SHA-256)
- JSON-LD data browser (reads from OPFS sovereign graph)
- tractor WebSocket integration (BrowserSyncClient)
- WCAG 2.2 AA accessibility
- i18n support (pt-BR, en, es)
```

---

## v0.6.0 — Observability Dashboard

**Scope**: Dev tools and telemetry visualization
**Depends on**: tractor TelemetryBus (v0.6.0 primitives)

### SDD (Spec Driven)

- [ ] Spec: Observability dashboard UI
  - [ ] Real-time event stream (from tractor TelemetryBus)
  - [ ] Metrics charts (time series)
  - [ ] Trace viewer (spans, flamegraphs)
  - [ ] Log viewer (filterable, searchable)
  - [ ] Dump browser (error dumps)
- [ ] Spec: Dashboard ↔ tractor telemetry bridge
  - [ ] Subscribe to tractor events (WebSocket)
  - [ ] Query historical telemetry (OPFS)
  - [ ] Export dumps/logs

### BDD (Behaviour Driven)

- [ ] E2E: User opens Dev Tools, sees live events
- [ ] E2E: User filters events by type
- [ ] E2E: User views metrics chart (memory, CPU)
- [ ] E2E: User inspects trace spans
- [ ] E2E: User downloads error dump
- [ ] Acceptance: Developers debug Refarm via Studio

### TDD (Test Driven)

- [ ] Unit: Event stream rendering
- [ ] Unit: Metrics data transformation (charts)
- [ ] Unit: Trace tree building
- [ ] Unit: Log filtering logic
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Dev Tools page (/dev)
- [ ] Domain: Observability components (event viewer, metrics, traces)
- [ ] Domain: Telemetry bridge (real-time subscriptions via tractor WS)
- [ ] Infra: Chart library (Chart.js or D3.js)
- [ ] Infra: WebSocket subscription for real-time events

### CHANGELOG

```
## [0.6.0] - YYYY-MM-DD
### Added
- Observability dashboard (Dev Tools)
- Real-time event stream from tractor TelemetryBus
- Metrics charts (memory, CPU, operations)
- Trace viewer for debugging
- Log viewer with filtering
- Dump browser for error analysis
```

---

## v0.7.0 — Graph Visualization

**Scope**: Interactive sovereign graph browser
**Depends on**: tractor sync stable (data model settled)

### SDD (Spec Driven)

- [ ] Spec: Graph visualization UI
  - [ ] Node rendering (entities: Person, Message, PluginRegistry, etc.)
  - [ ] Edge rendering (relationships)
  - [ ] Layout algorithms (force-directed, hierarchical)
  - [ ] Pan/zoom controls
  - [ ] Node selection and inspection
  - [ ] Search/filter nodes
- [ ] Spec: Graph data fetching
  - [ ] Query OPFS SQLite for graph subset
  - [ ] Lazy loading (viewport-based)
  - [ ] Real-time updates (Loro deltas → graph refresh)

### BDD (Behaviour Driven)

- [ ] E2E: User opens Graph page, sees visualization
- [ ] E2E: User pans/zooms graph
- [ ] E2E: User clicks node, sees details sidebar
- [ ] E2E: User searches for entity, graph highlights it
- [ ] E2E: Graph updates in real-time as tractor delivers deltas
- [ ] Acceptance: User visually explores sovereign graph

### TDD (Test Driven)

- [ ] Unit: Graph data transformation (JSON-LD → nodes/edges)
- [ ] Unit: Layout algorithm application
- [ ] Unit: Node selection logic
- [ ] Unit: Search/filter functionality
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Graph page (/graph)
- [ ] Domain: Graph visualization component (Lit + D3/Cytoscape)
- [ ] Domain: Graph query bridge (OPFS SQLite → viz layer)
- [ ] Infra: D3.js or Cytoscape.js integration
- [ ] Infra: Canvas rendering for performance

### CHANGELOG

```
## [0.7.0] - YYYY-MM-DD
### Added
- Interactive sovereign graph visualization
- Pan/zoom controls
- Node selection and inspection
- Search and filter nodes
- Real-time graph updates from tractor Loro deltas
```

---

## v0.8.0 — Sovereign Plugin Marketplace

**Scope**: Graph-driven plugin discovery, marketplace UI, and registry management
**Depends on**: v0.5.0 (Studio), `refarm:PluginRegistry` graph schema stable

### SDD (Spec Driven)

- [ ] Spec: Plugin marketplace UI
  - [ ] Browse plugins (from `refarm:PluginRegistry` nodes in graph)
  - [ ] Plugin detail page (description, permissions, reviews)
  - [ ] Install/uninstall workflow (via `installPlugin()` + SHA-256)
  - [ ] Plugin configuration UI
  - [ ] Plugin updates (version management)
- [ ] Spec: Graph registry integration
  - [ ] Query `refarm:PluginRegistry` nodes from OPFS
  - [ ] Verify SHA-256 signatures via `installPlugin()`
  - [ ] Publish user's own plugins to their graph (personal registry)

### BDD (Behaviour Driven)

- [ ] E2E: User browses plugin marketplace (graph-sourced catalog)
- [ ] E2E: User installs plugin from marketplace
- [ ] E2E: User configures plugin settings
- [ ] E2E: User uninstalls plugin
- [ ] E2E: User updates plugin to new version
- [ ] Acceptance: Developer extends Refarm via graph-driven marketplace

### TDD (Test Driven)

- [ ] Unit: Plugin list rendering (from graph nodes)
- [ ] Unit: Install workflow logic (installPlugin + SHA-256)
- [ ] Unit: Manifest validation
- [ ] Unit: Configuration form generation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Plugin marketplace page (/plugins/marketplace)
- [ ] Domain: Plugin detail components
- [ ] Domain: Install/config wizards
- [ ] Infra: `refarm:PluginRegistry` graph query client

### CHANGELOG

```
## [0.8.0] - YYYY-MM-DD
### Added
- Sovereign plugin marketplace (graph-driven, reads refarm:PluginRegistry)
- Plugin discovery from developer's sovereign graph
- Install/uninstall via installPlugin() with SHA-256 validation
- Plugin configuration interface
- Plugin update management
```

---

## v1.0.0 — Production Polish

**Scope**: UI polish, performance, mobile responsive, graph browser maturity
**Depends on**: All features stable

### Quality Criteria

- [ ] Bundle size <200KB initial load (Astro SSG)
- [ ] Lighthouse score >90 (performance, accessibility)
- [ ] Mobile responsive (iOS/Android)
- [ ] All components documented (Storybook)
- [ ] UI/UX consistent (design system)
- [ ] Loading states for all async operations
- [ ] Error states user-friendly
- [ ] Empty states informative

### SDD (Spec Driven)

- [ ] Spec: Performance optimization strategy
  - [ ] Code splitting (per-route)
  - [ ] Lazy loading (components, images)
  - [ ] Asset optimization (image compression)
- [ ] Spec: Mobile responsive patterns
  - [ ] Breakpoints (mobile, tablet, desktop)
  - [ ] Touch-friendly controls
  - [ ] Adaptive layouts
- [ ] Spec: Production graph browser
  - [ ] Inspect `refarm:PluginRegistry` nodes as first-class UI
  - [ ] Inspect project nodes, identity nodes
  - [ ] Bootstrap vs sovereign mode indicator (visible to developer)

### BDD (Behaviour Driven)

- [ ] E2E: Studio loads in <2s on 3G
- [ ] E2E: All pages work on mobile (iOS Safari, Chrome Android)
- [ ] E2E: Touch gestures work (swipe, pinch-zoom on graph)
- [ ] E2E: Developer can inspect their sovereign graph nodes directly
- [ ] Acceptance: Studio is delightful to use

### TDD (Test Driven)

- [ ] Unit: Responsive layout logic
- [ ] Unit: Image lazy loading
- [ ] Visual Regression: Screenshot tests (Percy/Chromatic)
- [ ] Coverage: >85%

### DDD (Domain Implementation)

- [ ] Polish: Performance optimizations
- [ ] Polish: Mobile responsive CSS
- [ ] Polish: Loading/error/empty states
- [ ] Polish: Animations and transitions
- [ ] Docs: Storybook for components
- [ ] Docs: User guide (screenshots, videos)

### CHANGELOG

```
## [1.0.0] - YYYY-MM-DD
### Changed
- Performance optimizations (code splitting, lazy loading)
- Mobile responsive design (all pages)
- Improved loading states and error handling
- Enhanced visual design and animations
- Production-quality sovereign graph browser

### Fixed
- [All known UI bugs addressed]
```

---

## Notes

- **Development Order**: Studio starts at v0.5.0 (after Gate 3 — tractor pairing stable)
- **Graph awareness**: every Studio feature that touches plugins or config reads from the sovereign graph (OPFS) — never from a hardcoded URL
- **Shell plugins**: Herald and Firefly are always npm dependencies — not discovered from graph
- **Testing**: E2E tests critical (Playwright with visual regression)
- **Accessibility**: WCAG 2.2 AA non-negotiable for all features
- **Performance**: Astro SSG keeps initial load fast despite rich UI
- **i18n**: All text content must be in locale files from day 1
