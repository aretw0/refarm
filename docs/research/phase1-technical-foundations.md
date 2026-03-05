# Phase 1 Technical Foundations

**Wiki de fundamentação técnica** - Referência rápida para decisões arquiteturais.  
**Status**: Validado ✅ | **Updated**: 2026-03-04

---

## 1. Interface: PWA + Web Components

**Specs**:

- [W3C App Manifest](https://www.w3.org/TR/appmanifest/) | [Service Workers](https://www.w3.org/TR/service-workers/) | [Custom Elements](https://html.spec.whatwg.org/multipage/custom-elements.html)
- Browser: Chrome 67+, Firefox 63+, Safari 10.1+, Edge 79+

**Por que**: Instalável como app nativo, funciona offline, extensível via Web Components.

**Framework**: [Astro v5+](https://astro.build) - Zero JS default, Islands Architecture, Web Components native.

**Produção**: VS Code (PWA), Figma (Web Components), Obsidian (offline-first), Excalidraw (installable).

**Pendente**: ADR sobre Astro integration pattern para WASM plugins.

---

## 2. Storage: SQLite + OPFS

**Specs**:

- [File System API (OPFS)](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) - Living Standard
- Browser: Chrome 86+, Firefox 111+, Safari 15.2+
- Quota: ~100GB (device-dependent)

**SQLite**:

- [sql.js](https://github.com/sql-js/sql.js) ou [SQLite3 Wasm oficial](https://sqlite.org/wasm/)
- Acesso síncrono via `FileSystemSyncAccessHandle` (essencial para WASM)

**Por que**: Banco relacional completo no browser, sem servidor, ~100GB storage.

**Produção**: VS Code (OPFS), DuckDB-Web (SQLite Wasm), Figma (local cache).

**Pendente**: Benchmark sql.js vs SQLite Wasm; ADR sobre backup/restore pattern.

---

## 3. Runtime: WebAssembly + WASI

**Specs**:

- [WebAssembly Core](https://webassembly.org/) - W3C Recommendation (2019)
- [WASI Preview 2](https://github.com/WebAssembly/WASI) - Component Model + [WIT IDL](https://github.com/WebAssembly/component-model/blob/main/design/mvp/WIT.md)
- Browser: 100% coverage

**Por que**: Sandboxing nativo, capability-based security, plugins seguros.

**WIT contract** (`refarm-sdk.wit`):

- Define capabilities (filesystem, network, crypto)
- Runtime valida permissions antes de executar plugin
- Plugins compiled to `.wasm` com interface declarada

**Produção**: Figma (WASM plugins), Shopify (extensões), Cloudflare Workers (isolamento).

**Pendente**: ADR sobre WASI capability enforcement; validação de runtime sandbox.

---

## 4. Sync: CRDT (Yjs)

**Spec**:

- [CRDT Research](https://crdt.tech/) | [Yjs Docs](https://docs.yjs.dev/)
- Algoritmo: YATA (Yet Another Transformation Approach)

**Performance**:

- **13x mais rápido** que Automerge ([benchmark](https://github.com/dmonad/crdt-benchmarks))
- B4: 259k ops em 5.7s (Automerge: 28.6s)
- B4x100: 25M+ ops em 608s, 327MB memory
- State vector: 29 bytes (eficiente)

**Por que**: Merge automático de conflitos, offline-first, sem coordenação central.

**Produção**: Figma (multiplayer), Linear (real-time), Notion-like apps.

**Pendente**: Validação de merge under heavy network partition; ADR sobre conflict UX.

---

## 5. AI: WebLLM + Transformers.js

**WebLLM**:

- [@mlc-ai/web-llm](https://www.npmjs.com/package/@mlc-ai/web-llm) v0.2.79+
- Suporta Web Worker nativo (`WebWorkerMLCEngineHandler`)
- WebGPU (Chrome 130+) + WASM fallback
- Modelos: Phi-2 (2.7B), Llama 2/3

**Transformers.js**:

- [@huggingface/transformers](https://huggingface.co/docs/transformers.js/) 50M+ downloads
- Embeddings, classification, NER - tudo no browser
- ONNX Runtime + WASM backend

**Por que**: LLM local sem servidor, zero cost inference, privacy-first.

**Validação crítica**: ✅ WebLLM executa em Worker (não bloqueia UI) - [Ver validação](critical-validations.md#1).

**Produção**: Notion AI (embeddings), ChatGPT Web (local models experimental).

---

## 6. Data: JSON-LD + Schema Validation

**Specs**:

- [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) - W3C Recommendation (2020)
- [SHACL](https://www.w3.org/TR/shacl/) - W3C Recommendation (2017) para validation
- [Schema.org](https://schema.org/) vocabulários

**Por que**: Semântica padronizada, interoperável, evoluível com upcasting.

**Schema evolution** via Event Sourcing:

- Events immutáveis (append-only log)
- Upcasting transforma eventos antigos → formato novo
- Schema version tracking via JSON-LD `@context`

**Produção**: Google Knowledge Graph (JSON-LD), Wikidata (linked data), DBPedia.

**Pendente**: ADR sobre upcasting strategy; validação de performance SHACL em ~10k docs.

---

## 7. Browser Support Matrix

| Tech | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| PWA | 67+ | 63+ | 10.1+ | 79+ |
| OPFS | 86+ | 111+ | 15.2+ | 86+ |
| WASM | 57+ | 52+ | 11+ | 16+ |
| Web Components | 67+ | 63+ | 10.1+ | 79+ |
| WebGPU (WebLLM) | 130+ | Exp | 17+ (Exp) | 130+ |
| WASM fallback | ✅ | ✅ | ✅ | ✅ |

**Target**: Chrome 86+, Firefox 111+, Safari 15.2+

---

## 8. Production References

**Offline-first**:

- VS Code Web - PWA + OPFS
- Figma - WASM plugins + CRDT sync
- Obsidian - Local-first notes
- Excalidraw - Installable PWA

**CRDT/Sync**:

- Linear - Yjs real-time sync
- Replicache - Client-side cache
- ElectricSQL - Local-first SQL

**WebAssembly**:

- Shopify Hydrogen - WASM extensions
- Cloudflare Workers - V8 isolates
- Figma - Plugin sandbox

---

## Next Actions

**Before v0.1.0**:

- [ ] [ADR-001](../../specs/ADRs/): Monorepo boundaries
- [ ] [ADR-002](../../specs/ADRs/): Offline-first strategy
- [ ] [ADR-003](../../specs/ADRs/): CRDT choice rationale
- [ ] Validate OPFS quota limits (cross-browser test)
- [ ] Benchmark SQLite Wasm vs sql.js

**Continuous**:

- Track spec updates (W3C, WHATWG)
- Monitor browser compatibility changes
- Update when new production cases emerge

---

**Ver também**: [Critical Validations](critical-validations.md) | [Phases 2-4 Research](phases2-4-technical-research.md) | [Architecture](../ARCHITECTURE.md)
