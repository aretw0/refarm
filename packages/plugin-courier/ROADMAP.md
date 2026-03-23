# Courier (O Carteiro) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Signal Foundation (DONE/In Progress)
**Scope**: Establish the core HTTP request handler and node materialization logic.  
**Gate**: Verified `.well-known/sovereign-signal` and basic HTML output.

### SDD (Spec Driven) ✅
- [x] Spec: `AntennaPlugin` request handler.
- [x] Spec: Simple HTML materializer for JSON-LD nodes.
- [x] Spec: Broadcast headers and metadata.

### BDD (Behaviour Driven) ✅
- [x] Integration: Request `/.well-known/sovereign-signal` returns ASCII art.
- [x] Integration: Querying a node by URL returns a rendered HTML page.
- [x] Integration: Correct 404 handling for unknown nodes.

### TDD (Test Driven) ✅
- [x] Unit: Request routing logic.
- [x] Unit: HTML template materialization.
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `AntennaPlugin` logic.
- [x] Infra: Node.js/Fetch-compatible request handling.

---

## v0.2.0 - Custom Templates & Markdown
**Scope**: Enabling rich rendering beyond basic HTML.

- [ ] Implementation of **Markdown Materializer**: Converting markdown-content nodes into HTML on the fly.
- [ ] **Sovereign Templates**: Allowing the user to define rendering templates as nodes in the graph.

---

## v0.3.0 - P2P Broadcasting & Edge
**Scope**: Distributing the signal across decentralized networks.

- [ ] Implementation of **Edge Deployment**: Running the Courier in Cloudflare Workers or Deno Deploy (Strategic Alignment).
- [ ] **Nostr/IPFS Discovery**: Broadcasting node availability via decentralized discovery layers.

---

## Notes
- See [packages/plugin-courier/src/index.ts](./src/index.ts) for core logic.
- The "Radio Tower" of the sovereign farm — broadcasting your truth to the web.
