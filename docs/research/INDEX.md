# Research Index

**Technical Research for Refarm — Phase 1 & Beyond**

This folder documents **technology validations and technical research** that inform the roadmap and architecture decisions.

---

## 📋 Structure

### Pre-Roadmap Validation

**[critical-validations.md](./critical-validations.md)**  
*Status*: ✅ Research Completed (March 2026)

Answers fundamental "can we?" questions for Phase 1 core technologies:

- **WebLLM + Web Workers**: Can we run LLMs in background without blocking UI?
- **CRDT + OPFS Quota**: What's the practical storage limit for Yjs sync?
- **SQLite WASM**: Browser performance benchmarks and file format validation
- **WASM Sandboxing**: Runtime capability enforcement for plugins
- **Nostr Integration**: Keypair management and DM encryption patterns

Each validation includes:

- ✅ Answer (yes/no/qualified)
- 🔗 Official sources and documentation
- 📊 Performance benchmarks or evidence
- 🚀 Production examples (VS Code, Figma, Notion, etc.)
- ⏳ Pending ADRs for implementation patterns

**→ Use this when**: Proposing Phase 1 features; validating architectural feasibility before SDD.

---

### Phase 1: Technical Foundations

**[phase1-technical-foundations.md](./phase1-technical-foundations.md)**  
*Status*: ✅ Validated (March 2026)  
*Roadmap Integration*: v0.1.0 – v0.5.0

Quick-reference for Phase 1 decision taxonomy:

| Layer | Technology | Why | Framework/Lib | Browser Support |
|-------|-----------|-----|----------------|-----------------|
| Interface | PWA + Web Components | Zero-JS default, extensible | Astro v5+ | Chrome 67+, Firefox 63+ |
| Storage | SQLite + OPFS | Relational DB, ~100GB offline | sql.js / wasm | Chrome 86+, Firefox 111+, Safari 15.2+ |
| Runtime | WASM + WASI | Sandboxed plugins, capability-based | WIT IDL | 100% coverage |
| Sync | CRDT (Yjs) | Conflict-free merge, offline-first | Yjs | Universal |
| AI | WebLLM + Transformers.js | Local inference, no API calls | @mlc-ai/web-llm | Chrome 130+, WASM fallback |
| Identity | Nostr Protocol | Self-sovereign, no backend | nostr-tools | All browsers |

Each section includes:

- 📖 W3C specs and official docs
- ⚡ Performance metrics and browser coverage
- 🏭 Production references (real-world usage)
- 🔄 Pending ADRs for this layer

**→ Use this when**: Onboarding new contributors; explaining Phase 1 architectural choices; writing ADRs for specific layers.

---

### Market & Strategy Analysis

**[competitive-analysis.md](./competitive-analysis.md)**  
*Status*: ✅ Complete (March 2026)  
*Purpose*: Strategic positioning and competitive differentiation

Deep-dive comparison with major competitors:

- **SilverBullet** — Direct competitor (PWA, Markdown, programmable, offline-first)
- **Obsidian** — Market leader (1M+ users, plugins, graph)
- **Logseq** — Open-source outliner (linked references, queries)
- **Anytype** — Privacy-first P2P (encrypted, block-based)

Includes:

- 📊 Feature comparison matrix
- 🎯 SWOT analysis (Strengths, Weaknesses, Opportunities, Threats)
- 💡 Strategic differentiation (WASM sandbox, JSON-LD, Nostr identity)
- 🚀 Competitive advantages and positioning
- 📈 Recommendations by phase (v0.1.0 through v1.0.0)

**→ Use this when**: Strategic planning; explaining market position; prioritizing features vs competitors; investor/community communication.

---

**[design-system-bootstrap-discussion.md](./design-system-bootstrap-discussion.md)**  
*Status*: 🟡 Draft for alignment (March 2026)  
*Purpose*: Decision criteria for bootstrapping a headless design system (internal + external)

Maps when and how to bootstrap UI infrastructure with sane defaults:

- 🎯 Objective trigger model (critical + scale signals)
- ♿ Accessibility-first component contracts (keyboard, focus, ARIA)
- 🌍 i18n-first defaults (keys, fallbacks, ICU/pluralization)
- 🧱 Phase plan: Foundation bootstrap → internal productization → externalization
- 🧭 Documentation architecture mapping (research, architecture, roadmap, ADR)

**→ Use this when**: deciding timing for UI platform investment; planning plugin-facing UI contracts; preventing a11y/i18n debt before ecosystem growth.

---

**[browser-extension-discussion.md](./browser-extension-discussion.md)**  
*Status*: ✅ Complete (March 2026)  
*Decision*: Defer to v0.7.0+ (PWA is sufficient for MVP)

Analyzes necessity of browser extension vs PWA-only approach:

**Key Findings:**

- PWA covers 90% of functionality natively (offline, storage, notifications)
- Extension adds marginal value for: web clipping, context menus, side panel
- Bookmarklet + Web Share Target sufficient for v0.1.0-v0.6.0
- Build extension only when ≥100 users + explicit demand

Includes:

- 🔍 Use case analysis (clipping, context menus, background sync, sidebar)
- 🏗️ Architecture options (light forwarding vs embedded kernel)
- ⚖️ PWA vs Extension comparison table
- 📅 Phased recommendations (when to build, what features)
- 🔧 Alternative solutions (bookmarklet, Web Share Target, File System Access)

**→ Use this when**: Planning v0.4.0+ roadmap; evaluating extension requests; explaining why PWA-first strategy.

---

### Phases 2-4: Future Research

**[phases2-4-technical-research.md](./phases2-4-technical-research.md)**  
*Status*: ✅ Researched (March 2026)  
*Roadmap Integration*: v0.6.0 – v1.0.0+ (Post-MVP)

Advanced technologies for later phases:

**Phase 2: AI Advanced** (v0.3.0+)

- Live Queries (GraphQL subscriptions)
- Vector Search (HNSW for semantic search)
- Fine-tuning (LoRA/PEFT for domain adaptation)

**Phase 3: Distribution + P2P** (v0.4.0+)

- Matrix Protocol (federated sync)
- WebRTC P2P Data Channels (direct peer connections)
- Distributed Tracing (OpenTelemetry)

**Phase 4: Blockchain + Governance** (v1.0.0+)

- Smart Contracts (validation layer)
- DAOs (governance primitives)
- Proof Systems (verifiable claims)

Each research item includes:

- 🔗 Specs and papers
- 📝 Rationale ("Por que")
- 🏭 Production examples
- ⏳ Questions or blockers

**→ Use this when**: Planning Phase 2+ sprints; evaluating new technology candidates; understanding long-term vision.

---

## 🔄 Integration with Project

### How This Feeds Into ROADMAP.md

```
Research (this folder)
    ↓ Validates feasibility
    ↓ Provides performance data
    ↓ Identifies pending ADRs
    ↓
Roadmap (roadmaps/MAIN.md)
    → Each milestone references validations
    → Pre-SDD phase links to critical-validations.md
    → ADR requirements cascade from here
    ↓
Architecture (docs/ARCHITECTURE.md)
    → Technical decisions formalized
    → Implementation patterns specified
    ↓
Implementation (src/**)
    → Code follows validated patterns
    → References ADRs for rationale
```

### Reading Order for Contributors

1. **New to the project?** → Start with [docs/ARCHITECTURE.md](../ARCHITECTURE.md), then jump to [phase1-technical-foundations.md](./phase1-technical-foundations.md)
2. **Implementing Phase 1?** → Read [critical-validations.md](./critical-validations.md) for your layer, then reference [docs/WORKFLOW.md](../WORKFLOW.md) for SDD/BDD/TDD
3. **Planning Phase 2+?** → Check [phases2-4-technical-research.md](./phases2-4-technical-research.md) for technology maturity
4. **Questioning a decision?** → Find the validation or research file, then open the related ADR in [specs/ADRs/](../../specs/ADRs/)

---

## 🔬 Research Process

### How We Research

1. **Feasibility Question** ("Can we do X?")
2. **Evidence Gathering** (specs, benchmarks, source code)
3. **Production Examples** (prove it's used at scale)
4. **Document Finding** (in this folder)
5. **Write ADR** (if decision needed for Phase 1)
6. **Add to Roadmap** (schedule SDD/implementation)

### Validations as Decision Records

- ✅ = **Confirmed viable**, move to SDD phase
- ❌ = **Not viable**, find alternative, document why
- ⚠️ = **Conditional**, requires further validation during SDD
- ⏳ = **Pending**, needs benchmark/prototype

---

## 📊 Current Status

| Research | Status | Phase | Result |
|----------|--------|-------|--------|
| **Technical Validations** | | | |
| WebLLM + Web Workers | ✅ Complete | 1 | **Viable** - Worker pattern supported, non-blocking UI confirmed |
| CRDT + OPFS Quota | ✅ Complete | 1 | **Viable** - 100GB practical limit, Yjs 13x faster than alternatives |
| SQLite WASM | ✅ Complete | 1 | **Viable** - Sub-100ms parse time, sync access handle for WASM |
| WASM Sandboxing | ✅ Complete | 1 | **Viable** - Capability-based WASI Preview 2 supports enforcement |
| Nostr Integration | ✅ Complete | 1 | **Viable** - NIP-01, NIP-05, NIP-65 proven in production |
| **Strategic Analysis** | | | |
| Competitive Analysis | ✅ Complete | All | **Complete** - Positioning vs SilverBullet, Obsidian, Logseq, Anytype |
| Browser Extension Need | ✅ Complete | All | **Decision: Defer to v0.7.0+** - PWA sufficient, bookmarklet + Web Share Target cover MVP |
| **Future Research** | | | |
| Live Queries (GraphQL) | ✅ Complete | 2 | **Researched** - Ready for Phase 2+ planning |
| Vector Search (HNSW) | ✅ Complete | 2 | **Researched** - Ready for semantic search phase |
| Fine-tuning (LoRA) | ✅ Complete | 2 | **Pending** - Validate WebLLM adapter support |
| Matrix Protocol | ✅ Complete | 3 | **Researched** - Decide vs WebRTC P2P tradeoff |
| WebRTC P2P | ✅ Complete | 3 | **Researched** - Needs signaling architecture ADR |
| Smart Contracts | ✅ Complete | 4 | **Researched** - Post-v1.0 exploration |

---

## 🤝 Contributing Research

To add research for a new technology:

1. **File**: Create `{topic}-research.md` in this folder
2. **Template**: Use the format from existing files
   - Question/Answer structure
   - Sources and links
   - Performance data or evidence
   - Production examples
   - Pending issues/ADRs
3. **Integration**: Link from [phases2-4-technical-research.md](./phases2-4-technical-research.md) or [critical-validations.md](./critical-validations.md)
4. **Roadmap**: If Phase 1, add ADR requirement to [roadmaps/MAIN.md](../../roadmaps/MAIN.md)

---

## 📚 Related Documentation

- **Architecture**: [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — Strategic decisions and system design
- **Workflow**: [docs/WORKFLOW.md](../WORKFLOW.md) — SDD → BDD → TDD → DDD methodology
- **Roadmap**: [roadmaps/MAIN.md](../../roadmaps/MAIN.md) — Timeline and milestones
- **ADRs**: [specs/ADRs/](../../specs/ADRs/) — Architecture Decision Records
- **Contributing**: [CONTRIBUTING.md](../../CONTRIBUTING.md) — How to add research to this folder

---

**Last Updated**: March 2026  
**Research Lead**: @refarm-contributors  
**Phase 1 Target**: v0.1.0 – v0.5.0 (Foundation through Studio + Local AI)
