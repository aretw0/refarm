# Phases 2-4 Technical Research

**Wiki de tecnologias futuras** - Referência para planejamento de longo prazo.  
**Status**: Pesquisado ✅ | **Priority**: Post-v1.0.0 | **Updated**: 2026-03-04

---

## Phase 2: AI Advanced (v0.3.0+)

### Live Queries (GraphQL Subscriptions)

**Specs**: [GraphQL](https://graphql.org/blog/subscriptions-in-graphql-and-relay/) | [WebSocket W3C](https://www.w3.org/TR/websockets/)  
**Libs**: [Apollo Server](https://www.apollographql.com/docs/apollo-server/data/subscriptions/), [graphql-ws](https://github.com/enisdenjo/graphql-ws)

**Por que**: Real-time data sync entre múltiplos clientes. PubSub pattern escalável.

**Production**: Facebook Relay, GitHub GraphQL API, Hasura subscriptions.

**Alternatives**: [Relay Live Queries](https://relay.dev/docs/guided-tour/refetching/refreshing-queries/#polling-with-uselivequery) (cache-based, zero infra).

---

### Vector Search (HNSW)

**Specs**: [HNSW Paper (arXiv 1603.09320)](https://arxiv.org/abs/1603.09320) | [hnswlib](https://github.com/nmslib/hnswlib)  
**Performance**: O(log N) search, 98% recall@K=10, ~1ms queries (200M vectors)

**Por que**: Semantic search em embeddings (Transformers.js output). Busca por similaridade.

**Browser**: Pode usar [hnswlib-wasm](https://github.com/yoshoku/hnswlib-node) compilado para WASM. Alternativa: [usearch](https://github.com/unum-cloud/usearch).

**Production**: Spotify (music recommendations), Notion (semantic search), Pinterest (visual search).

**Pendente**: Benchmark HNSW em WASM vs native; OPFS storage pattern para índices.

---

### Fine-tuning (LoRA/PEFT)

**Specs**: [LoRA Paper](https://arxiv.org/abs/2106.09685) | [Hugging Face PEFT](https://huggingface.co/docs/peft/)  
**Method**: Low-Rank Adaptation (LoRA) - 99% parameter reduction, 98% quality retention

**Por que**: Adaptar LLMs para domínios específicos sem retreinar modelo completo.

**Workflow**:

1. Treinar LoRA adapter (~50MB) com dados do usuário
2. Merge adapter com base model (WebLLM)
3. Inference usa modelo adaptado

**Production**: ChatGPT custom models, Hugging Face Inference API.

**Pendente**: Validar se WebLLM suporta LoRA adapters; storage overhead de múltiplos adapters.

---

## Phase 3: Distribution + P2P (v0.4.0+)

### Matrix Protocol (Network Layer)

**Specs**: [Matrix.org](https://matrix.org/) | [Client-Server API](https://spec.matrix.org/latest/client-server-api/)  
**Por que**: Decentralized sync via federated servers. Alternativa ao backend centralizado.

**Production**: Element (chat), Gitter (acquired by Matrix), NHS (UK healthcare).

**Trade-off**: Adiciona complexidade de federação. Avaliar se necessário vs simples WebRTC P2P.

---

### WebRTC P2P Data Channels

**Specs**: [W3C WebRTC](https://www.w3.org/TR/webrtc/) - Recommendation (March 2025)  
**Protocol**: ICE/STUN/TURN for NAT traversal, DTLS encryption mandatory

**Por que**: Direct peer-to-peer connections (<50ms latency), sem servidor intermediário.

**Browser**: Chrome 25+, Firefox 22+, Safari 11+

**Production**: Google Meet, Zoom Web, Discord voice.

**Pendente**: ADR sobre signaling server (Matrix? Custom?); fallback para relay quando P2P fail.

---

### Distributed Tracing (OpenTelemetry)

**Specs**: [OpenTelemetry](https://opentelemetry.io/) | [W3C Trace Context](https://www.w3.org/TR/trace-context/)  
**Por que**: Debug de fluxos distribuídos (browser → P2P → servers).

**Production**: Datadog, New Relic, Jaeger visualization.

**Pendente**: Avaliar overhead em browser; privacy implications de traces.

---

## Phase 4: Blockchain + Governance (v1.0.0+)

### Smart Contracts (Validation)

**Specs**: [Web3.js v4](https://docs.web3js.org/) | [Ethereum Smart Contracts](https://ethereum.org/en/developers/docs/smart-contracts/)  
**Por que**: Validação criptográfica de documentos via Merkle proofs. Timestamping imutável.

**L2 Solutions**: Polygon, Arbitrum (<$0.01/tx vs $1-100 mainnet).

**Production**: Gitcoin (on-chain reputation), ENS (domains), Proof of Humanity.

**Caution**: Gas costs variáveis. Considerar apenas para auditoria crítica, não storage bulk.

**Pendente**: ADR sobre quando usar blockchain vs local signatures; escolha de L2.

---

### GraphQL Federation (Distributed Schema)

**Specs**: [Apollo Federation](https://www.apollographql.com/docs/federation/)  
**Por que**: Compor múltiplos GraphQL services em schema unificado. Útil se ecosystem crescer com múltiplos providers.

**Production**: Netflix (microservices), Shopify APIs.

**Trade-off**: Overhead de coordenação. Avaliar apenas se >5 services independentes.

---

## Timeline Estimates

**Phase 2** (Meses 4-6 após v1.0):

- Vector search integration
- Fine-tuning workflow (optional)
- Live queries (if real-time critical)

**Phase 3** (Meses 7-9, optional):

- P2P connections (WebRTC)
- Distributed tracing setup
- Matrix integration (if decentralization priority)

**Phase 4** (Meses 10-12, optional):

- Blockchain validation (audit-only)
- Federated schemas (if multi-provider ecosystem)

---

## Decision Points

**Before Phase 2**:

- [ ] Measure actual need for vector search (wait for user data)
- [ ] Validate WebLLM performance - is fine-tuning needed?
- [ ] Decide: Real-time sync via subscriptions or polling sufficient?

**Before Phase 3**:

- [ ] Measure P2P viability (NAT traversal success rate in target regions)
- [ ] Decide: Matrix federation or simpler WebRTC-only?
- [ ] Evaluate distributed tracing ROI vs complexity

**Before Phase 4**:

- [ ] Legal review: blockchain validation requirements
- [ ] Gas cost analysis: L2 affordable for expected volume?
- [ ] Decide: On-chain vs off-chain with signatures

---

## Browser Compatibility (Future)

| Tech | Chrome | Firefox | Safari | Notes |
|------|--------|---------|--------|-------|
| GraphQL Subscriptions | 43+ | 11+ | 5.1+ | WebSocket support |
| HNSW (WASM) | 57+ | 52+ | 11+ | WASM required |
| WebRTC | 25+ | 22+ | 11+ | W3C Rec 2025 |
| Web3.js | All | All | All | Library-based |

---

## Key Takeaways

1. **Phase 2** adds AI sophistication - measure need before implementing
2. **Phase 3** enables true decentralization - high complexity, evaluate trade-offs
3. **Phase 4** provides immutability/governance - use sparingly (gas costs)
4. **All phases optional** - v1.0 is viable with Phase 1 only

**Recommendation**: Ship v1.0 first. Validate with real users. Then decide priorities for Phases 2-4 based on feedback.

---

**Ver também**: [Phase 1 Foundations](phase1-technical-foundations.md) | [Critical Validations](critical-validations.md) | [Main Roadmap](../../roadmaps/MAIN.md)
