# Refarm - Main Roadmap

**Semantic Versioning**: Major.Minor.Patch  
**Current**: v0.0.1-dev  
**Next Release**: v0.1.0 (MVP Core)

---

## Release Strategy

- **Patch (0.0.x)**: Bug fixes, documentation
- **Minor (0.x.0)**: New features, non-breaking changes
- **Major (x.0.0)**: Breaking changes, architectural shifts

Each release follows: **SDD → BDD → TDD → DDD** (see [Workflow Guide](../docs/WORKFLOW.md))

**Why this flow?**

- **SDD**: Define specs/ADRs before coding (prevents chaos)
- **BDD**: Write integration tests that FAIL (expected behavior)
- **TDD**: Write unit tests that FAIL (contracts)
- **DDD**: Implement until tests PASS (green phase)

**Quality Gates**: Cannot proceed to next phase until previous is peer-reviewed and complete.

---

## v0.1.0 - MVP Core (Em planejamento)

**Milestone**: Offline-first storage + Guest mode foundation  
**Target**: Sprint 1-2

### ⚠️ Pre-Sprint 0: Preparatory Work (Semana 0 - IN PROGRESS)

**Status**: Complete - Ready for Sprint 1 SDD  
**Tracking**: See [Pre-Sprint Checklist](../docs/pre-sprint-checklist.md) and [Sprint 1](../docs/sprints/sprint-1.md)  
**Quick Start**: See [validations/QUICK_START.md](../validations/QUICK_START.md)

**Completed** ✅:

- [x] ADR-001: Monorepo structure (Turborepo + npm workspaces)
- [x] ADR-002: Offline-first architecture (Storage → Sync → Network)
- [x] ADR-003: CRDT choice (Yjs benchmarks + rationale)
- [x] ADR-009: OPFS persistence (directory structure, quota)
- [x] WIT contract verified (refarm-sdk.wit complete)
- [x] JSON-LD schema expanded (9 practical examples)
- [x] Sub-roadmaps detailed (kernel, storage, sync technical decisions)
- [x] ✨ **NEW**: Validation environment configured ([validations/](../validations/))
  - [x] Rust + WASM toolchain setup script
  - [x] Hello-world plugin project (Rust)
  - [x] Browser host for WASM testing
  - [x] SQLite benchmark scripts (wa-sqlite vs sql.js)

**Pending** ⚠️ (BLOCKERS):

- [ ] **Validação WASM + WIT**
  - ✅ Environment ready (just run `setup-rust-toolchain.ps1`)
  - [x] Compile hello-world plugin: `cargo component build --release`
  - [ ] Test in browser: `npm run dev` in `validations/wasm-plugin/host/`
  - [ ] Verify metrics: load < 100ms, size < 500KB
  - **Quick Start**: [validations/QUICK_START.md](../validations/QUICK_START.md)

- [ ] **SQLite Engine Decision**
  - ✅ Benchmarks ready (just run `npm run bench:all`)
  - [x] Execute benchmarks: `cd validations/sqlite-benchmark && npm run bench:all`
  - [x] Analyze results and fill `validations/sqlite-benchmark/results.md`
  - [x] Update ADR-015 with decision
  - **Quick Start**: [validations/QUICK_START.md](../validations/QUICK_START.md)

**Recommended** (non-blocking):

- [x] ADR-010: JSON-LD schema evolution (Lenses or migrations) — already written
- [x] ADR-013: Testing strategy (Vitest vs Jest, Playwright) — already written

**Decision Gate**: ✅ WASM validation + SQLite decision complete → proceed to Pre-SDD

**How to Execute**: See [validations/QUICK_START.md](../validations/QUICK_START.md) for step-by-step guide.

---

### Pre-SDD: Research & Validation (Semana 1-2)
*(Verificações técnicas antes de especificar)*

- [ ] Completar Validação 3: WASI capability enforcement (compilação + teste)
- [ ] Completar Validação 4: JSON-LD schema evolution (exemplo prático)
- [ ] Criar PoC mínimo validando interop (Storage + CRDT em Web Worker)
- [ ] Benchmark SQLite Wasm vs sql.js (operações alta frequência)
- [ ] Benchmark CRDT bulk operations (OPFS persistence)
- [ ] Validar storage tiers para guest sessions (ephemeral/persistent/synced)
- [ ] Testar migração guest→permanent (rewrite de ownership, 100k nodes)
- [ ] Benchmark OPFS init para guest vaults (tempo de criação de vault)

**Decision Gate**: ✅ PoC funcional + performance aceitável → proceed to SDD

### SDD (Spec Driven Development)

- [ ] ADR-001: Monorepo structure & workspace boundaries
- [ ] ADR-002: Offline-first strategy (Storage → Sync → Network)
- [ ] ADR-003: CRDT choice (Yjs) + conflict resolution
- [ ] ADR-006: Guest mode and collaborative sessions (identity-orthogonal storage)
- [ ] Spec: Storage interface (`storage-sqlite` package)
- [ ] Spec: Sync interface (`sync-crdt` package)
- [ ] Spec: Session management (guest vs. permanent identity, storage tiers)

### BDD (Behaviour Driven Development)

- [ ] Integration: Guest joins shared board without identity
- [ ] Integration: Guest chooses storage tier (ephemeral/persistent/synced)
- [ ] Integration: Guest edits data (stored in chosen backend)
- [ ] Integration: Guest upgrades to permanent (ownership rewrite, storage unchanged)
- [ ] Integration: Permanent user persists data offline
- [ ] Integration: Data syncs between 2 clients (CRDT)
- [ ] Integration: Conflicts merge automatically
- [ ] Acceptance: User works offline, syncs when online
- [ ] Acceptance: Guest can participate in collaborative boards

### TDD (Test Driven Development)

- [ ] Unit: Guest session creation (vaultId generation + storage tier selection)
- [ ] Unit: Guest→Permanent migration (ownership rewrite, no storage migration)
- [ ] Unit: Storage CRUD contracts (unified API across all tiers)
- [ ] Unit: CRDT merge operations
- [ ] Unit: Conflict resolution rules
- [ ] Coverage: >80% core logic

### DDD (Domain Driven Implementation)

- [ ] Domain: `session-manager` (guest vs. permanent lifecycle)
- [ ] Domain: `storage-sqlite` (persistence boundary, OPFS adapters)
- [ ] Domain: `sync-crdt` (sync boundary, vector clocks)
- [ ] Domain: `kernel` (orchestration, session handling)
- [ ] Infra: OPFS adapters, Yjs providers
- [ ] Infra: Storage tier abstraction (ephemeral/persistent/synced)
- [ ] Infra: Sync code mechanism for guest multi-device (WebRTC handshake)

### CHANGELOG (when done)
TBD - to be generated from completed work

---

## v0.2.0 - Identity + Network
**Milestone**: Nostr identity + P2P Network foundation  
**Status**: Awaiting v0.1.0  
**Target**: Sprint 3-4

### Pre-SDD: Research & Validation

- [ ] Validate Nostr NIPs compatibility (NIP-01, NIP-19, NIP-26)
- [ ] Test nostr-tools browser bundle size impact
- [ ] Benchmark Matrix SDK in Web Worker context
- [ ] Test WebRTC data channels for P2P sync
- [ ] Validate network abstraction patterns (adapter pattern)

**Decision Gate**: ✅ Identity + Network patterns validated → proceed to SDD

### SDD (Spec Driven Development)

- [ ] ADR-004: Identity provider choice (Nostr) + key management
- [ ] ADR-005: Network abstraction layer (Matrix/WebRTC/Nostr hybrid)
- [ ] Spec: `identity-nostr` package interface
  - [ ] Key generation (NIP-06 BIP-39 mnemonic)
  - [ ] NIP-07 browser extension compatibility
  - [ ] Event signing interface
  - [ ] Profile management (NIP-01 metadata)
- [ ] Spec: Network layer interface
  - [ ] Relay connection management
  - [ ] Event publishing/subscription
  - [ ] P2P discovery (WebRTC signaling)
  - [ ] Message routing abstraction

### BDD (Behaviour Driven Development)

- [ ] Integration: User generates Nostr keypair
- [ ] Integration: App signs events with user identity
- [ ] Integration: Device A discovers Device B on same network
- [ ] Integration: Devices sync data P2P via WebRTC
- [ ] Integration: App publishes event to Nostr relay
- [ ] Integration: App receives event from relay (subscription)
- [ ] Acceptance: User controls identity, data syncs between devices

### TDD (Test Driven Development)

- [ ] Unit: Key generation (deterministic from seed)
- [ ] Unit: Event signature verification
- [ ] Unit: Relay connection lifecycle
- [ ] Unit: P2P handshake protocol
- [ ] Unit: Network adapter switching (relay ↔ P2P)
- [ ] Coverage: >80% identity + network logic

### DDD (Domain Driven Implementation)

- [ ] Domain: `identity-nostr` (keypair, signing, profiles)
- [ ] Domain: `network` layer (relay, P2P, abstraction)
- [ ] Domain: `kernel` orchestration (identity + network)
- [ ] Infra: nostr-tools integration
- [ ] Infra: Matrix SDK integration (optional)
- [ ] Infra: WebRTC adapter for P2P

### CHANGELOG
TBD - to be generated from completed work

---

## v0.3.0 - Local AI Inference
**Milestone**: WebLLM + Transformers.js for local AI  
**Status**: Awaiting v0.2.0  
**Target**: Sprint 5-6

### Pre-SDD: Research & Validation

- [ ] Test WebLLM model loading time (Phi-3, Llama-3.1)
- [ ] Benchmark inference speed (WebGPU vs WASM)
- [ ] Test Transformers.js ONNX runtime performance
- [ ] Validate memory footprint (2B vs 7B models)
- [ ] Test multi-tab coordination (SharedWorker for model sharing)
- [ ] Validate streaming output in Web Worker context

**Decision Gate**: ✅ Model performance acceptable → proceed to SDD

### SDD (Spec Driven Development)

- [ ] ADR-012: LLM execution strategy (WebLLM in Workers)
- [ ] ADR-014: Model selection criteria (size, performance, licensing)
- [ ] ADR-016: Embedding generation (Transformers.js vs WebLLM)
- [ ] Spec: AI inference interface
  - [ ] Model loading/unloading lifecycle
  - [ ] Streaming chat completion
  - [ ] Structured generation (JSON mode)
  - [ ] Context window management
  - [ ] Embedding generation API
- [ ] Spec: Model cache strategy (OPFS persistence)

### BDD (Behaviour Driven Development)

- [ ] Integration: User sends prompt, receives streamed response
- [ ] Integration: Model persists in OPFS (no re-download)
- [ ] Integration: Multiple tabs share same model instance
- [ ] Integration: Embeddings generated for semantic search
- [ ] Integration: AI respects context window limits
- [ ] Acceptance: User chats with local AI, no internet required

### TDD (Test Driven Development)

- [ ] Unit: Model loading from OPFS
- [ ] Unit: Token counting and context trimming
- [ ] Unit: Streaming output buffering
- [ ] Unit: Embedding vector normalization
- [ ] Unit: Worker message protocol
- [ ] Coverage: >80% AI orchestration logic

### DDD (Domain Driven Implementation)

- [ ] Domain: `ai-inference` package (WebLLM wrapper)
- [ ] Domain: `embeddings` package (Transformers.js wrapper)
- [ ] Domain: `kernel` orchestration (AI + workers)
- [ ] Infra: WebLLM integration (@mlc-ai/web-llm)
- [ ] Infra: Transformers.js integration (@xenova/transformers)
- [ ] Infra: SharedWorker for multi-tab model sharing

### CHANGELOG
TBD - to be generated from completed work

---

## v0.4.0 - Plugin Ecosystem & WASI
**Milestone**: WASM plugin architecture with capability-based security  
**Status**: Awaiting v0.3.0  
**Target**: Sprint 7-8

### Pre-SDD: Research & Validation

- [ ] Complete Validação 3: WASI capability enforcement
- [ ] Test wasm-tools component model compilation
- [ ] Validate WIT IDL for plugin contracts
- [ ] Benchmark WASM execution overhead
- [ ] Test capability delegation patterns
- [ ] Validate plugin sandboxing (memory isolation)

**Decision Gate**: ✅ WASI + Component Model validated → proceed to SDD

### SDD (Spec Driven Development)

- [ ] ADR-010: Plugin architecture (WASM component model)
- [ ] ADR-011: Capability system (WASI capabilities)
- [ ] ADR-012: Plugin lifecycle (load, init, execute, unload)
- [ ] ADR-013: Plugin distribution (registry, signatures)
- [ ] Spec: Plugin SDK interface (WIT contracts)
  - [ ] Storage capability (read/write JSON-LD)
  - [ ] Network capability (HTTP/fetch)
  - [ ] AI capability (inference requests)
  - [ ] Identity capability (signing)
- [ ] Spec: Plugin manifest format (JSON-LD)
- [ ] Spec: Plugin discovery and installation

### BDD (Behaviour Driven Development)

- [ ] Integration: User installs plugin from manifest
- [ ] Integration: Plugin requests storage capability
- [ ] Integration: Kernel grants/denies capability
- [ ] Integration: Plugin executes in sandbox (no escape)
- [ ] Integration: Plugin crashes, kernel recovers
- [ ] Integration: Multiple plugins coexist without interference
- [ ] Acceptance: User extends Refarm safely with plugins

### TDD (Test Driven Development)

- [ ] Unit: Plugin manifest validation
- [ ] Unit: Capability checking (grant/deny logic)
- [ ] Unit: WASM module loading
- [ ] Unit: Plugin sandbox creation
- [ ] Unit: Inter-plugin communication (event bus)
- [ ] Coverage: >80% plugin orchestration

### DDD (Domain Driven Implementation)

- [ ] Domain: `plugin-runtime` (WASM execution)
- [ ] Domain: `capability-system` (permission management)
- [ ] Domain: `plugin-sdk` (WIT interfaces + tooling)
- [ ] Domain: `kernel` orchestration (plugin lifecycle)
- [ ] Infra: wasm-tools integration
- [ ] Infra: wasmtime/wasmer runtime
- [ ] Example: `matrix-bridge` plugin (reference Go implementation)
- [ ] Example: `signal-bridge` plugin (reference Rust implementation)

### CHANGELOG
TBD - to be generated from completed work

---

## v0.5.0 - Studio Interface
**Milestone**: Web-based management UI (Astro + Lit)  
**Status**: Awaiting v0.4.0  
**Target**: Sprint 9-10

### Pre-SDD: Research & Validation

- [ ] Prototype Astro SSG + Lit components integration
- [ ] Test Lit component state management patterns
- [ ] Validate Astro i18n routing (astro-i18next)
- [ ] Test Web Components for WCAG 2.2 accessibility
- [ ] Benchmark Astro build performance with dynamic routes

**Decision Gate**: ✅ Astro + Lit stack validated → proceed to SDD

### SDD (Spec Driven Development)

- [ ] ADR-014: Studio architecture (Astro SSG + Lit Web Components)
- [ ] ADR-015: State management (Lit reactive controllers + kernel bridge)
- [ ] ADR-016: Headless UI Contract and Token Strategy ✨ **PHASE A START**
- [ ] ADR-017: Routing strategy (Astro file-based + client-side)
- [ ] Spec: `packages/ui-headless` interface (6-8 core primitives)
  - [ ] Button, Dialog, Menu, Tabs, Toast, FormField, Listbox, Combobox
  - [ ] Keyboard navigation contracts (Tab, Enter, Escape, Arrow keys)
  - [ ] Focus management for modals and overlays
  - [ ] ARIA roles and semantic HTML
- [ ] Spec: `packages/ui-tokens` (semantic design tokens)
  - [ ] Color tokens (primary, surface, error, success, etc.)
  - [ ] Spacing scale (0-16)
  - [ ] Typography scale (xs-2xl) + weights
  - [ ] Motion tokens (duration + easing)
- [ ] Spec: Studio UI components library
  - [ ] Graph visualization (d3.js/cytoscape.js)
  - [ ] Plugin management UI
  - [ ] Identity/profile editor
  - [ ] Data inspector (JSON-LD browser)
  - [ ] Dev tools (observability dashboard)
- [ ] Spec: Studio ↔ Kernel IPC (postMessage protocol)
- [ ] Spec: Accessibility compliance (WCAG 2.2 Level AA)

### BDD (Behaviour Driven Development)

- [ ] Integration: User navigates Studio UI
- [ ] Integration: Studio displays sovereign graph visualization
- [ ] Integration: User installs plugin via UI
- [ ] Integration: Studio shows real-time kernel state
- [ ] Integration: Dev tools display telemetry events
- [ ] Integration: All interactions are keyboard-accessible
- [ ] Acceptance: User manages Refarm entirely via Studio UI

### TDD (Test Driven Development)

- [ ] Unit: Lit component rendering logic
- [ ] Unit: Astro route generation
- [ ] Unit: IPC message validation
- [ ] Unit: Graph data transformations
- [ ] E2E: Full user workflows with Playwright
- [ ] Coverage: >80% Studio logic

### DDD (Domain Driven Implementation)

- [ ] Domain: `packages/ui-headless` (headless primitives)
  - [ ] Implement 6-8 core components with keyboard + ARIA contracts
  - [ ] All user-facing text via translation keys
  - [ ] Tests for keyboard interaction (Vitest + Playwright)
- [ ] Domain: `packages/ui-tokens` (design tokens)
  - [ ] CSS Custom Properties for runtime theming
  - [ ] TypeScript type definitions for tokens
- [ ] Domain: `studio` app (Astro + Lit components)
  - [ ] Migrate all components to use `ui-headless` primitives
  - [ ] Component catalog with real-world examples
- [ ] Domain: Component library (Lit Web Components)
- [ ] Domain: Studio ↔ Kernel bridge
- [ ] Infra: Astro integration
- [ ] Infra: Lit Element components
- [ ] Infra: D3.js/Cytoscape.js for graphs
- [ ] Infra: astro-i18next for i18n
- [ ] Quality Gate: UI Component PR Checklist enforced (.github/PULL_REQUEST_TEMPLATE_UI.md)

### CHANGELOG
TBD - to be generated from completed work

**Phase A Success Metrics** ✨:
- [ ] 100% of interactive components in `apps/studio` use `ui-headless` primitives
- [ ] 0 axe-core violations in CI for core UI
- [ ] 100% of user-facing strings use translation keys
- [ ] Keyboard navigation covers all critical paths (tested in Playwright)

---

## v0.6.0 - Observability & Self-Healing
**Milestone**: Production-grade monitoring and error recovery  
**Status**: Awaiting v0.5.0  
**Target**: Sprint 11-12

**Reference**: [ADR-007 Observability & Introspection Primitives](../specs/ADRs/ADR-007-observability-primitives.md)

### Pre-SDD: Research & Validation (ADR-007 covers this)

- [ ] Benchmark telemetry overhead (sampling strategies)
- [ ] Test dump generation performance (state snapshot cost)
- [ ] Validate observer plugin isolation (separate Workers)
- [ ] Test self-healing recovery time (error → restart)
- [ ] Validate anonymization of telemetry data

**Decision Gate**: ✅ Observability patterns validated → proceed to SDD

### SDD (Spec Driven Development)

- [ ] ADR-007: Finalize Observability & Introspection Primitives (DRAFT → ACCEPTED)
- [ ] ADR-018: Error recovery strategies (graceful degradation)
- [ ] ADR-019: Telemetry data retention (OPFS storage limits)
- [ ] Spec: UI Headless Phase B ✨ **INTERNAL PRODUCTIZATION**
  - [ ] Component catalog with composition examples
  - [ ] Translation guidelines for shared component copy
  - [ ] Automated a11y testing in CI (axe-core + Playwright)
- [ ] Spec: Observability SDK
  - [ ] Event emission API (`emit()`, `subscribe()`)
  - [ ] Metrics collection (counters, gauges, histograms)
  - [ ] Trace spans (OpenTelemetry-compatible)
  - [ ] Dump generation API (`captureDump()`)
  - [ ] Error boundary interface
- [ ] Spec: Observer plugin interface
  - [ ] Official telemetry plugin (opt-in)
  - [ ] Third-party observer API (Sentry, Grafana)

### BDD (Behaviour Driven Development)

- [ ] Integration: Kernel emits event, observers receive it
- [ ] Integration: Plugin crashes, kernel isolates and restarts
- [ ] Integration: Dump generated and saved to OPFS
- [ ] Integration: User consents to telemetry, dumps upload
- [ ] Integration: Observer plugin installed (Sentry example)
- [ ] Integration: Studio displays live telemetry dashboard
- [ ] Acceptance: System never fully crashes, always recovers

### TDD (Test Driven Development)

- [ ] Unit: Event emission and subscription
- [ ] Unit: Dump serialization/deserialization
- [ ] Unit: Error boundary isolation logic
- [ ] Unit: Observer plugin registration
- [ ] Unit: Telemetry opt-in consent flow
- [ ] Coverage: >80% observability logic

### DDD (Domain Driven Implementation)

- [ ] Domain: `observability` package (primitives)
- [ ] Domain: `error-recovery` (self-healing logic)
- [ ] Domain: `kernel` orchestration (error boundaries)
- [ ] Domain: Official `telemetry-plugin` (opt-in)
- [ ] Domain: UI system metrics ✨ **PHASE B**
  - [ ] Track: % components with complete a11y contract
  - [ ] Track: % strings internationalized vs hardcoded
  - [ ] Track: Average UI PR review time
  - [ ] Track: Number of a11y regressions per release
  - [ ] Track: Component duplication rate
- [ ] Infra: OPFS dump storage
- [ ] Infra: Observer Worker isolation
- [ ] Example: Sentry observer plugin

### CHANGELOG
TBD - to be generated from completed work

**Phase B Success Metrics** ✨:
- [ ] Average PR review time for UI reduced by 30%
- [ ] Zero a11y regressions for 2 consecutive releases
- [ ] Component duplication rate < 5%
- [ ] Translation coverage > 95%

---

## v0.7.0+ - Plugin SDK & UI Externalization
**Milestone**: Stable plugin API + external UI contracts ✨ **PHASE C**  
**Status**: Awaiting v0.6.0  
**Target**: Sprint 13-15

### Pre-SDD: Research & Validation

- [ ] Validate `ui-headless` API stability with internal usage patterns
- [ ] Test external plugin scenarios (UI composition without core coupling)
- [ ] Benchmark plugin UI rendering performance
- [ ] Validate versioning policy for UI contract breaking changes

**Decision Gate**: ✅ Internal UI API stable → proceed to externalization

### SDD (Spec Driven Development)

- [ ] ADR-020: Public UI component API and versioning policy ✨ **PHASE C START**
- [ ] Spec: Plugin-facing UI contracts
  - [ ] Slots and composition patterns
  - [ ] State management hooks
  - [ ] Theme token inheritance
- [ ] Spec: Plugin developer guide for accessible UI composition
- [ ] Spec: Breaking change policy and migration paths

### BDD (Behaviour Driven Development)

- [ ] Integration: External plugin uses `ui-headless` Dialog primitive
- [ ] Integration: Plugin theme inherits from core tokens
- [ ] Integration: Plugin UI respects keyboard navigation contracts
- [ ] Integration: Plugin UI maintains a11y compliance
- [ ] Acceptance: First community plugin successfully uses UI API

### DDD (Domain Driven Implementation)

- [ ] Domain: Public `@refarm/ui-sdk` package (stable API)
- [ ] Docs: Plugin UI composition guide
- [ ] Docs: UI contract migration examples
- [ ] Example: Reference plugin with custom UI components
- [ ] Quality Gate: External plugin UI checklist

### CHANGELOG
TBD - to be generated from completed work

**Phase C Success Metrics** ✨:
- [ ] ≥1 external plugin successfully uses `ui-headless` API
- [ ] API breaking change rate < 1 per minor version
- [ ] Plugin UI developer satisfaction > 4/5
- [ ] Zero plugin-caused a11y regressions

---

## Future Considerations (Post-v1.0)

**Status**: Exploratory — Not committed to roadmap

### Potential v1.x Features

- **Mobile Native**: Capacitor/Tauri wrappers for iOS/Android
- **Desktop Native**: Tauri app for Windows/macOS/Linux
- **Cloud Sync Bridge**: Optional bridge for non-P2P sync scenarios
- **Advanced AI**: Fine-tuning, RAG, multi-modal models
- **Enterprise Features**: Team workspaces, admin controls, compliance
- **Plugin Marketplace**: Curated registry with reviews/ratings
- **Visual Plugin Builder**: Low-code plugin creation tool
- **Federation**: Relay federation for decentralized network

### Technology Evolution

- **WebGPU Maturity**: Better AI inference performance
- **WASM Component Model**: Stable spec for advanced plugin features
- **Nostr Evolution**: New NIPs (NIP-46 remote signing, etc.)
- **Matrix 2.0**: Next-gen Matrix protocol features
- **Storage Evolution**: SQL.js → SQLite WASM official build

**Note**: These are NOT commitments. Post-v1.0 roadmap will be community-driven based on user feedback and adoption.

---

## v1.0.0 - Production Ready
**Milestone**: Stable release ready for general use  
**Status**: Awaiting v0.6.0  
**Target**: Sprint 13-15

### Pre-Release: Production Validation

- [ ] Complete security audit (external)
- [ ] Performance benchmarks met (see criteria below)
- [ ] Accessibility audit (WCAG 2.2 AA compliance)
- [ ] Browser compatibility testing (Chrome, Firefox, Safari, Edge)
- [ ] Load testing (concurrent users, large datasets)
- [ ] Documentation complete (user + developer)
- [ ] Migration guide from alpha versions

**Decision Gate**: ✅ All validation passed → proceed to release

### SDD (Spec Driven Development)

- [ ] ADR-021: Versioning and deprecation policy
- [ ] ADR-022: Breaking change guidelines
- [ ] ADR-023: Long-term support (LTS) strategy
- [ ] Spec: Public API stability guarantees
- [ ] Spec: Upgrade/migration tooling

### BDD (Behaviour Driven Development)

- [ ] Integration: User upgrades from alpha to v1.0
- [ ] Integration: Existing data migrates automatically
- [ ] Integration: Plugins continue working (compatibility)
- [ ] Integration: All features work in production scenarios
- [ ] Acceptance: User trusts Refarm for production use

### TDD (Test Driven Development)

- [ ] Unit: All packages >80% coverage
- [ ] E2E: Critical user journeys covered
- [ ] Performance: Benchmarks pass consistently
- [ ] Regression: No known unfixed bugs (P0/P1)
- [ ] Coverage: Integrated test suite >75%

### DDD (Domain Driven Implementation)

- [ ] Polish: All TODOs resolved
- [ ] Polish: Error messages user-friendly
- [ ] Polish: Performance optimizations applied
- [ ] Polish: Bundle size optimized (<500KB kernel)
- [ ] Docs: User guide complete
- [ ] Docs: API reference generated
- [ ] Docs: Example applications published

### Performance Criteria (Must Pass)

| Metric | Target | Validation |
|--------|--------|------------|
| Cold Start | <2s (kernel init) | ✅ Benchmark |
| Storage Write | <50ms (single doc) | ✅ Benchmark |
| Storage Read | <10ms (indexed query) | ✅ Benchmark |
| CRDT Sync | <200ms (1000 ops) | ✅ Benchmark |
| AI Inference | <1s/token (WebGPU) | ✅ Benchmark |
| Plugin Load | <100ms (small WASM) | ✅ Benchmark |
| Memory Usage | <200MB (idle state) | ✅ Profiling |
| Bundle Size | <500KB (kernel gzip) | ✅ Build analysis |

### Quality Criteria (Must Pass)

| Area | Target | Validation |
|------|--------|------------|
| Test Coverage | >80% (core packages) | ✅ Jest/Vitest |
| Accessibility | WCAG 2.2 AA | ✅ axe-core |
| Security | 0 high/critical vulns | ✅ npm audit |
| Browser Support | Chrome 120+, Firefox 120+, Safari 17+ | ✅ Manual testing |
| Mobile Support | iOS 17+, Android 14+ | ✅ BrowserStack |
| Internationalization | pt-BR, en, es complete | ✅ i18n:check |

### Documentation Criteria (Must Complete)

- [ ] User Guide: Getting Started
- [ ] User Guide: Core Concepts
- [ ] User Guide: Plugin Development
- [ ] API Reference: Full coverage (TypeDoc)
- [ ] Architecture Guide: System overview
- [ ] Migration Guide: Alpha → v1.0
- [ ] Troubleshooting Guide: Common issues
- [ ] Video Tutorials: Key workflows

### CHANGELOG

```
## [1.0.0] - YYYY-MM-DD

### Stable Release

First production-ready release of Refarm.

**What's Included**:
- ✅ Offline-first storage (SQLite + OPFS)
- ✅ CRDT sync (Yjs)
- ✅ Nostr identity
- ✅ Local AI inference (WebLLM)
- ✅ Plugin ecosystem (WASM)
- ✅ Studio UI (Astro + Lit)
- ✅ Observability & self-healing

**Breaking Changes**:
- None (first stable release)

**Known Limitations**:
- [List any known limitations]
```

---

## Package-Specific Roadmaps

Ver roadmaps individuais para detalhes de implementação:

- [apps/kernel/ROADMAP.md](../apps/kernel/ROADMAP.md)
- [apps/studio/ROADMAP.md](../apps/studio/ROADMAP.md)
- [packages/storage-sqlite/ROADMAP.md](../packages/storage-sqlite/ROADMAP.md)
- [packages/sync-crdt/ROADMAP.md](../packages/sync-crdt/ROADMAP.md)
- [packages/identity-nostr/ROADMAP.md](../packages/identity-nostr/ROADMAP.md)

---

## Process Notes

**Como usar este roadmap:**

1. Cada release = milestone com escopo fechado
2. Cada fase tem quality gates (ver [WORKFLOW.md](../docs/WORKFLOW.md))
3. **SDD** primeiro (specs/ADRs) → decisões arquiteturais
4. **BDD** segundo (integration tests RED) → comportamento esperado
5. **TDD** terceiro (unit tests RED) → contratos detalhados
6. **DDD** por último (implementation) → código até tests GREEN

**Quality Gates (não pula fases sem peer review)**:

- SDD → BDD: ADRs completos, specs sem TODO
- BDD → TDD: Integration tests escritos (FAILING)
- TDD → DDD: Unit tests escritos (FAILING)
- DDD → Done: All tests GREEN, coverage ≥80%, changeset criado

**Tracking progress:**

- CHANGELOGs gerados a partir de changesets (`npm run changeset:version`)
- Checklists migram para issues/PRs quando começamos sprint
- Decisões importantes viram ADRs em `specs/ADRs/`

**Referências técnicas:**

- [docs/WORKFLOW.md](../docs/WORKFLOW.md) - Workflow detalhado (SDD→BDD→TDD→DDD)
- [docs/research/](../docs/research/) - Wiki de fundamentação técnica
- [specs/ADRs/](../specs/ADRs/) - Architecture Decision Records
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) - Visão geral do sistema
