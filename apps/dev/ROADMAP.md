# Studio - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
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

## v0.1.0 - Foundation (Skip - Kernel Focus)
**Status**: Deferred  
**Reason**: v0.1.0 focuses on kernel, storage, sync (headless)

Studio development begins in v0.5.0 after core backend is stable.

---

## v0.2.0 - Foundation (Skip - Identity/Network Focus)
**Status**: Deferred  
**Reason**: v0.2.0 focuses on identity and network layers (backend only)

---

## v0.3.0 - Foundation (Skip - AI Focus)
**Status**: Deferred  
**Reason**: v0.3.0 focuses on AI inference (backend only)

---

## v0.4.0 - Foundation (Skip - Plugin Focus)
**Status**: Deferred  
**Reason**: v0.4.0 focuses on plugin runtime (backend only)

---

## v0.5.0 - Studio MVP
**Scope**: Initial Studio UI with core management features  
**Depends on**: `kernel` v0.4.0 (plugin system ready)

### SDD (Spec Driven)

**Goal**: Define Studio architecture and UI components  
**Gate**: Specs complete, peer reviewed, no TODOs

- [ ] ADR-014: Studio architecture (Astro + Lit)
- [ ] ADR-015: State management (Lit reactive controllers)
- [ ] ADR-016: Routing strategy (Astro file-based + client-side)
- [ ] Spec: Studio ↔ Kernel IPC protocol
  - [ ] Command pattern (Studio → Kernel)
  - [ ] Query pattern (Studio ← Kernel)
  - [ ] State sync (real-time updates)
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
- [ ] E2E: Studio connects to kernel via IPC
- [ ] E2E: User installs plugin via UI
- [ ] E2E: User browses JSON-LD data
- [ ] E2E: All interactions are keyboard-accessible
- [ ] Acceptance: Studio provides full Refarm management capability

### TDD (Test Driven)

**Goal**: Write unit tests for contracts (FAILING)  
**Gate**: Tests written (🔴 RED), coverage ≥80%

- [ ] Unit: Lit component rendering
- [ ] Unit: IPC message validation
- [ ] Unit: Route generation (Astro)
- [ ] Unit: State management (reactive controllers)
- [ ] Unit: Form validation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

**Goal**: Implement code until all tests PASS  
**Gate**: Tests GREEN (🟢), coverage met, changeset created

- [ ] Domain: Astro pages (index, plugins, data, settings)
- [ ] Domain: Lit component library (30+ components)
- [ ] Domain: IPC bridge (Studio ↔ Kernel)
- [ ] Domain: State management layer
- [ ] Infra: Astro configuration (SSG, i18n, routes)
- [ ] Infra: Lit Element integration
- [ ] Infra: astro-i18next (pt-BR, en, es)
- [ ] Asset: Design system (colors, typography, spacing)

### CHANGELOG

```
## [0.5.0] - YYYY-MM-DD
### Added
- Studio MVP with core management UI
- Plugin management interface
- JSON-LD data browser
- Kernel IPC integration
- WCAG 2.2 AA accessibility
- i18n support (pt-BR, en, es)
```

---

## v0.6.0 - Observability Dashboard
**Scope**: Dev tools and telemetry visualization  
**Depends on**: `kernel` v0.6.0 (observability primitives)

### SDD (Spec Driven)

- [ ] Spec: Observability dashboard UI
  - [ ] Real-time event stream
  - [ ] Metrics charts (time series)
  - [ ] Trace viewer (spans, flamegraphs)
  - [ ] Log viewer (filterable, searchable)
  - [ ] Dump browser (error dumps)
- [ ] Spec: Dashboard ↔ Kernel telemetry bridge
  - [ ] Subscribe to kernel events
  - [ ] Query historical telemetry
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
- [ ] Domain: Telemetry bridge (real-time subscriptions)
- [ ] Infra: Chart library (Chart.js or D3.js)
- [ ] Infra: WebSocket/postMessage for real-time

### CHANGELOG

```
## [0.6.0] - YYYY-MM-DD
### Added
- Observability dashboard (Dev Tools)
- Real-time event stream viewer
- Metrics charts (memory, CPU, operations)
- Trace viewer for debugging
- Log viewer with filtering
- Dump browser for error analysis
```

---

## v0.7.0 - Graph Visualization
**Scope**: Visual sovereign graph browser  
**Depends on**: `kernel` v0.6.0 (data stable)

### SDD (Spec Driven)

- [ ] Spec: Graph visualization UI
  - [ ] Node rendering (entities: Person, Message, etc.)
  - [ ] Edge rendering (relationships)
  - [ ] Layout algorithms (force-directed, hierarchical)
  - [ ] Pan/zoom controls
  - [ ] Node selection and inspection
  - [ ] Search/filter nodes
- [ ] Spec: Graph data fetching
  - [ ] Query kernel for graph subset
  - [ ] Lazy loading (viewport-based)
  - [ ] Real-time updates (CRDT changes)

### BDD (Behaviour Driven)

- [ ] E2E: User opens Graph page, sees visualization
- [ ] E2E: User pans/zooms graph
- [ ] E2E: User clicks node, sees details sidebar
- [ ] E2E: User searches for entity, graph highlights it
- [ ] E2E: Graph updates in real-time as data changes
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
- [ ] Domain: Graph query bridge
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
- Real-time graph updates
```

---

## v0.8.0 - Advanced Plugin Management
**Scope**: Plugin marketplace UI, discovery, ratings  
**Depends on**: `kernel` v0.4.0 (plugin system), external plugin registry

### SDD (Spec Driven)

- [ ] Spec: Plugin marketplace UI
  - [ ] Browse plugins (categories, search, filters)
  - [ ] Plugin detail page (description, permissions, reviews)
  - [ ] Install/uninstall workflow
  - [ ] Plugin configuration UI
  - [ ] Plugin updates (version management)
- [ ] Spec: Plugin registry integration
  - [ ] Fetch plugin manifests
  - [ ] Check signatures (security)
  - [ ] Download WASM bundles

### BDD (Behaviour Driven)

- [ ] E2E: User browses plugin marketplace
- [ ] E2E: User installs plugin from UI
- [ ] E2E: User configures plugin settings
- [ ] E2E: User uninstalls plugin
- [ ] E2E: User updates plugin to new version
- [ ] Acceptance: Non-technical users extend Refarm via Studio

### TDD (Test Driven)

- [ ] Unit: Plugin list rendering
- [ ] Unit: Install workflow logic
- [ ] Unit: Manifest validation
- [ ] Unit: Configuration form generation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Plugin marketplace page (/plugins/marketplace)
- [ ] Domain: Plugin detail components
- [ ] Domain: Install/config wizards
- [ ] Infra: Plugin registry API client

### CHANGELOG

```
## [0.8.0] - YYYY-MM-DD
### Added
- Plugin marketplace UI
- Plugin discovery and search
- One-click plugin installation
- Plugin configuration interface
- Plugin update management
```

---

## v1.0.0 - Production Polish
**Scope**: UI polish, performance, mobile responsive  
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

### BDD (Behaviour Driven)

- [ ] E2E: Studio loads in <2s on 3G
- [ ] E2E: All pages work on mobile (iOS Safari, Chrome Android)
- [ ] E2E: Touch gestures work (swipe, pinch-zoom on graph)
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

### Fixed
- [All known UI bugs addressed]
```

---

## Notes

- **Development Order**: Studio starts in v0.5.0 (after kernel mature)
- **Dependencies**: Studio depends on stable kernel IPC
- **Testing**: E2E tests critical (Playwright with visual regression)
- **Accessibility**: WCAG 2.2 AA non-negotiable for all features
- **Performance**: Astro SSG keeps initial load fast despite rich UI
- **i18n**: All text content must be in locale files from day 1
