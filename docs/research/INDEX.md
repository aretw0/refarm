# Research Archive Index

**Technical Research for Refarm — Completed Validations & Analysis**

This folder contains **completed research** that informed architectural decisions. Most findings are now consolidated into [specs/ADRs/](../../specs/ADRs/). Use this folder as a reference library.

**Note**: Redundant summaries have been removed. Consult the table below to find what you need.

---

## 📊 Quick Reference: Phase 1 Stack

| Layer | Technology | Decision | ADR | Status |
|-------|-----------|----------|-----|--------|
| Interface | PWA + Web Components | Zero-JS default, Astro v5+ | [ADR-008](../../specs/ADRs/ADR-008-ecosystem-technology-boundary.md) | ✅ v0.1.0 |
| Storage | SQLite + OPFS | Relational DB, ~100GB offline | [ADR-015](../../specs/ADRs/ADR-015-sqlite-engine-decision.md) | ✅ v0.1.0 |
| Runtime | WASM + WASI | Sandboxed plugins | [ADR-017](../../specs/ADRs/ADR-017-studio-micro-tractor-and-plugin-boundary.md) | ✅ v0.2.0 |
| Sync | CRDT (Yjs) | Conflict-free merge | [ADR-003](../../specs/ADRs/ADR-003-crdt-synchronization.md) | ✅ v0.3.0 |
| Identity | Nostr | Self-sovereign (deferred) | [ADR-008](../../specs/ADRs/ADR-008-ecosystem-technology-boundary.md) | ⏳ v0.7.0 |

---

## 📚 Research Archive

### Phase 1 Validation

**[critical-validations.md](./critical-validations.md)**  
Validates core Phase 1 technologies before SDD.

**Topics**: WebLLM + Workers, CRDT + OPFS quota, SQLite WASM, WASM sandboxing, Nostr integration  
**Contains**: Benchmarks, production references, evidence  
**→ Read when**: Validating technical feasibility; onboarding engineers to Phase 1 stack

---

### Strategic Analysis

**[competitive-analysis.md](./competitive-analysis.md)**  
Market positioning vs competitors (SilverBullet, Obsidian, Logseq, Anytype).

**Topics**: SWOT analysis, feature prioritization, competitive differentiation  
**Contains**: Comparison matrices, strategic recommendations  
**→ Read when**: Strategic planning; explaining market position; discussing long-term roadmap

---

### Browser & Extension Strategy

**[browser-extension-discussion.md](./browser-extension-discussion.md)**  
Analysis of PWA vs native extension necessity. **Decision: PWA sufficient for v0.1.0-v0.6.0; defer extension to v0.7.0+**

**Topics**: PWA capabilities, extension tradeoffs, alternative solutions (bookmarklet, Web Share API)  
**→ Read when**: Planning v0.4.0+ roadmap; justifying PWA-first approach

---

### WASM Runtime Validation

**[wasm-validation.md](./wasm-validation.md)**  
Manual testing procedures and runtime behavior for WASM plugins.

**Topics**: Cargo component build, plugin lifecycle, performance benchmarks  
**→ Read when**: Validating plugin ecosystem; benchmarking WASM performance

---

### Design System Considerations

**[design-system-bootstrap-discussion.md](./design-system-bootstrap-discussion.md)**  
Decision criteria for bootstrapping UI infrastructure with accessibility & i18n-first defaults.

**Topics**: Accessibility contracts, i18n patterns, bootstrap timing  
**→ Read when**: Planning design system roadmap; establishing component contracts for plugins

---

## 🔍 How to Find What You Need

| I want to... | Go to... |
|---|---|
| Confirm Phase 1 technical feasibility | critical-validations.md |
| Understand market positioning | competitive-analysis.md |
| Justify PWA-first strategy | browser-extension-discussion.md |
| Validate plugin runtime behavior | wasm-validation.md |
| Plan design system roadmap | design-system-bootstrap-discussion.md |
| Find a technical decision | [specs/ADRs/](../../specs/ADRs/) + table above |
| See Phase 2+ technology roadmap | [roadmaps/MAIN.md](../../roadmaps/MAIN.md) |

---

## 🔄 How Research Led to Decisions

```
Research (this folder: What did we learn?)
       ↓
   ADR Written (Why did we decide this?)
       ↓
   Roadmap Scheduled (When will we implement this?)
       ↓
   Implementation (How do we build this?)
```

---

## 📖 Related Documentation

- **ADRs**: [specs/ADRs/](../../specs/ADRs/) — Final architectural decisions
- **Architecture**: [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — System design
- **Roadmap**: [roadmaps/MAIN.md](../../roadmaps/MAIN.md) — Timeline & milestones
- **Workflow**: [docs/WORKFLOW.md](../WORKFLOW.md) — SDD → BDD → TDD process

---

**Last Updated**: March 2026  
**Research Status**: Phase 1 complete, Phase 2+ compiled into ADRs  
**Next**: See roadmaps/MAIN.md for implementation timeline
