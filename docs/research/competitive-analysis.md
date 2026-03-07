# Análise Comparativa: Refarm vs Concorrentes

**Data**: 2026-03-06  
**Status**: Draft para discussão  
**Objetivo**: Mapear posicionamento competitivo e identificar diferenciadores estratégicos

---

## Sumário Executivo

O Refarm opera no espaço de **Personal Knowledge Management (PKM)** com forte foco em **soberania de dados** e **extensibilidade via plugins WASM**. Esta análise compara o Refarm com os principais concorrentes identificados:

1. **SilverBullet** — Maior concorrente direto (PWA, Markdown, programável, offline-first)
2. **Obsidian** — Líder de mercado (local-first, plugins, grafo)
3. **Logseq** — Outliner open-source (linked references, queries)
4. **Anytype** — Privacy-first P2P (encrypted, block-based, descentralizado)

**Diferencial chave do Refarm**: Combinação única de **WASM plugins sandboxed**, **JSON-LD como formato universal**, **Nostr como marketplace descentralizado**, e **identidade soberana** (guest mode → permanent user sem fricção).

---

## Matriz Comparativa

| Característica | Refarm | SilverBullet | Obsidian | Logseq | Anytype |
|---|---|---|---|---|---|
| **Arquitetura** | Browser (SQLite/OPFS) | PWA/Server dual | Desktop app + mobile | Desktop + mobile | Desktop + mobile |
| **Offline-First** | ✅ Completo | ✅ Completo (PWA) | ✅ Completo | ✅ Completo | ✅ Completo |
| **Formato de Dados** | JSON-LD (RDF) | Markdown + metadata | Markdown | Markdown (org-mode) | Proprietary (encrypted) |
| **Extensibilidade** | WASM plugins + WIT | JavaScript (Deno) + Space Lua | JavaScript plugins | JavaScript plugins | No (roadmap futuro) |
| **Sandbox de Segurança** | ✅ WASM Component Model | ⚠️ Deno permissions | ❌ Full Node.js access | ❌ Full Node.js access | N/A |
| **Marketplace** | Nostr (NIP-89/94) | Built-in registry | Built-in + community | Built-in + community | N/A |
| **Identidade** | Nostr keypair (BIP-39) | User/password ou anon | Cloud sync (E2EE) | Cloud sync opcional | P2P encrypted keys |
| **Guest Mode** | ✅ (UUID, sem keypair) | ✅ Anon mode | ❌ | ❌ | ❌ |
| **Sincronização** | WebRTC P2P + Nostr | WebRTC ou server sync | Proprietary sync ($) | iCloud/Dropbox/Git | P2P (anytype protocol) |
| **Colaboração** | P2P (guest + permanent) | Server-based ou P2P | Shared vaults ($) | Git-based | P2P spaces (chats) |
| **Modelo de Dados** | Graph (JSON-LD) | Pages + objects | Graph (notes + links) | Pages + blocks | Objects (types + relations) |
| **Query Language** | GraphQL-like (planned) | Space Lua queries | Dataview plugin | Datomic-like queries | Built-in queries |
| **Portabilidade** | ✅ JSON-LD (import/export anywhere) | Markdown files | Markdown files | Markdown files | ⚠️ Export limitado |
| **License** | AGPL-3.0 | MIT | Proprietary (free personal) | AGPL-3.0 | Proprietary (free) |
| **Deploy** | Browser only | Self-hosted server ou cloud | Desktop download | Desktop download | Desktop download |
| **Custo** | Free (open-source) | Free (self-host) | Free (sync $10/mo) | Free | Free (sync paid beta) |

---

## Análise Detalhada por Concorrente

### 1. SilverBullet — Concorrente Mais Próximo

**Similaridades Estratégicas:**

- PWA offline-first (pode rodar sem servidor)
- Markdown como formato principal
- Extensível via scripting (Space Lua)
- Browser-based editing
- Open-source (MIT)
- Foco em programabilidade e extensão pelo usuário

**Diferenças Críticas:**

| Aspecto | Refarm | SilverBullet |
|---|---|---|
| **Plugins** | WASM sandboxed (WIT contracts) | Deno JavaScript + Lua scripts |
| **Segurança** | Isolation forte (nenhum acesso ao host) | Deno permissions + FFI permite escape |
| **Marketplace** | Nostr descentralizado (sem servidor) | Centralizado ou self-hosted registry |
| **Formato** | JSON-LD (RDF, semantic web) | Markdown puro + YAML frontmatter |
| **Identidade** | Nostr keypair (portável) | User/password (server-bound) |
| **Arquitetura** | Pure browser (SQLite OPFS) | Server Go + Deno frontend (pode rodar como PWA) |
| **Guest Mode** | Storage orthogonal to identity | Anonymous session (ephemeral) |

**Vantagem Competitiva do Refarm:**

1. **Segurança**: Plugin WASM não pode ler filesystem do host, fazer network requests arbitrários, ou executar código nativo. SilverBullet permite FFI e filesystem access via Deno.
2. **Portabilidade de Identidade**: Keypair Nostr funciona em qualquer relay. SilverBullet requer conta no servidor específico.
3. **Semantic Web**: JSON-LD permite importar/exportar para qualquer sistema RDF (Wikidata, Schema.org, ActivityPub).
4. **Zero Server**: Refarm é 100% browser. SilverBullet precisa de servidor para funcionar (embora possa rodar PWA cached).

**Quando SilverBullet é Melhor:**

- Usuários que já têm servidor self-hosted (mais fácil deploy via Docker)
- Necessidade de plugins com acesso completo ao filesystem
- Preferência por Lua em vez de WASM/Rust para scripting
- Não se importam com portabilidade de identidade

---

### 2. Obsidian — Líder de Mercado (~1M+ usuários)

**Posição de Mercado:**

- Desktop-first (Electron), mobile nativo
- Ecossistema massivo: 1700+ plugins, 200+ themes
- Modelo freemium: app free, sync $10/mês, publish $16/mês
- Proprietary (core closed-source, API open)

**Vantagens do Obsidian:**

| Aspecto | Obsidian | Refarm |
|---|---|---|
| **Maturidade** | Stable, 5+ anos de dev | Experimental (v0.1.0) |
| **Plugins** | 1700+ (JavaScript) | 0 (início) |
| **Performance** | Otimizado para 10K+ notes | Ainda não validado em escala |
| **Mobile** | Apps nativos (iOS/Android) | PWA apenas (limitações) |
| **Community** | 100K+ Discord members | Em formação |
| **Sync oficial** | E2EE, multi-device, $10/mês | P2P WebRTC (experimental) |

**Vantagens do Refarm:**

| Aspecto | Refarm | Obsidian |
|---|---|---|
| **Custo** | Free forever (AGPL-3.0) | Free app, paid sync/publish |
| **Deploy** | URL (browser) | Download app (>100MB) |
| **Segurança Plugins** | WASM sandbox | JavaScript full access |
| **Formato** | JSON-LD (semantic web) | Markdown + proprietary cache |
| **Identidade** | Nostr (descentralizado) | Obsidian account (centralizado) |
| **Guest Mode** | Sim (zero-friction onboarding) | Não (requer vault setup) |
| **Open Core** | AGPL-3.0 (tudo open) | Closed core, open API |

**Quando Obsidian é Melhor:**

- Usuários que precisam de apps nativos (desktop/mobile) com performance máxima
- Ecossistema de plugins maduro (Dataview, Tasks, Kanban, Templater, etc.)
- Disposto a pagar $10-16/mês por sinc/publish oficial com SLA
- Offline 100% sem dependência de browser web

**Quando Refarm é Melhor:**

- Soberania de dados (AGPL, sem vendor lock-in)
- Zero install (abre URL, funciona)
- Semantic web (JSON-LD exportável para RDF)
- Identidade descentralizada (Nostr keypair portável)
- Guest mode para colaboração sem fricção

---

### 3. Logseq — Open-Source Outliner

**Posição de Mercado:**

- Open-source (AGPL-3.0) — rival direto em filosofia
- Outliner-first (moldado por Roam Research)
- Desktop Electron + mobile apps
- 40K+ GitHub stars

**Similaridades:**

- Open-source (AGPL-3.0)
- Offline-first
- Extensível (plugins JavaScript)
- Query language para data views
- Graph visualization

**Diferenças:**

| Aspecto | Refarm | Logseq |
|---|---|---|
| **Estrutura** | Graph flexível (JSON-LD) | Outliner (hierarchical blocks) |
| **Deploy** | Browser-only | Desktop required |
| **Plugins** | WASM sandbox | JavaScript (no sandbox) |
| **Sync** | P2P (WebRTC + Nostr) | Cloud sync paid beta, Git, iCloud |
| **Identidade** | Nostr keypair | Local vault (no identity layer) |
| **Formato** | JSON-LD | Markdown + EDN (Clojure) metadata |

**Quando Logseq é Melhor:**

- Preferência por outliner em vez de editor livre
- Desktop app com performance nativa
- Integração com Obsidian plugins (via compatibilidade)
- Comunidade ativa (Discord 2K+ online)

**Quando Refarm é Melhor:**

- Browser-only (sem install)
- Semantic web (JSON-LD portável)
- Guest mode (onboarding sem fricção)
- Plugin sandbox (WASM seguro)

---

### 4. Anytype — Privacy-First P2P

**Posição de Mercado:**

- Startup financiada (~$13M Series A)
- Foco em privacy + descentralização + encryption
- P2P sync (sem servidor central)
- Desktop + mobile nativo

**Similaridades:**

- Privacy-first
- Offline-first
- P2P sync (sem servidor)
- Descentralização (Anytype usa IPFS + custom protocol)

**Diferenças:**

| Aspecto | Refarm | Anytype |
|---|---|---|
| **Formato** | JSON-LD (open) | Proprietary encrypted (closed) |
| **Extensibilidade** | WASM plugins | ❌ Nenhuma (closed) |
| **Open Source** | AGPL-3.0 | Closed-source (protocol documentado) |
| **Deploy** | Browser | Desktop app required |
| **Identidade** | Nostr keypair (BIP-39) | Anytype keypair (custom) |
| **Ecosystem** | Nostr relays (existente) | Anytype network (closed) |
| **Portabilidade** | Export JSON-LD | Export limitado (JSON proprietário) |

**Quando Anytype é Melhor:**

- Usuários não-técnicos que valorizam UX polida
- Necessidade de encryption E2E sem setup manual
- P2P sync funciona out-of-the-box
- Mobile apps nativos com gestures/swipe

**Quando Refarm é Melhor:**

- Open-source (auditável, hackable)
- Formato aberto (JSON-LD exportável)
- Extensibilidade (WASM plugins)
- Sem vendor lock-in (Nostr keypair portável)
- Browser-only (sem app install)

---

## Matriz de Posicionamento Competitivo

```
                      Open Source
                           ▲
                           │
        SilverBullet       │       Logseq
             ●             │          ●
                  Refarm   │
                    ●      │
                           │
  Browser-Based ◄──────────┼──────────► Desktop-First
                           │
                           │
                           │     Obsidian
                           │         ●
                           │
                           │      Anytype
                           │         ●
                           ▼
                    Closed Source
```

**Eixo Horizontal:**

- **Browser-Based** (esquerda): Zero install, abre URL, funciona (PWA)
- **Desktop-First** (direita): App nativo, performance máxima, offline completo

**Eixo Vertical:**

- **Open Source** (topo): AGPL, MIT, auditável, hackable
- **Closed Source** (base): Proprietary, vendor lock-in potencial

**Posicionamento dos Competidores:**

- **Refarm**: Browser-Based + Open Source (AGPL-3.0, pure PWA)
- **SilverBullet**: Browser-Based + Open Source (MIT, PWA/Server dual) — **Concorrente mais próximo**
- **Logseq**: Desktop-First + Open Source (AGPL-3.0, Electron)
- **Obsidian**: Desktop-First + Closed Source (Proprietary, freemium)
- **Anytype**: Desktop-First + Closed Source (Proprietary, funded)

---

## Diferenciadores Estratégicos do Refarm

### 1. Plugin Sandbox (WASM Component Model)

**Problema que resolve:**

- Todos os concorrentes (exceto Anytype sem plugins) permitem plugins JavaScript com acesso completo ao runtime (Node.js, Deno, ou Electron)
- Plugins podem ler arquivos sensíveis, fazer network requests arbitrários, executar código nativo via FFI
- Segurança depende de confiar no desenvolvedor do plugin

**Solução do Refarm:**

- WASM Component Model com WIT contracts
- Plugin só pode chamar funções explicitamente exportadas pelo kernel
- Capability-based security: plugin pede permissão para `fetch`, `storage`, etc.
- Impossível escapar sandbox sem explorar bug no browser

**Valor:** Marketplace aberto sem risco de malware.

---

### 2. JSON-LD como Formato Universal

**Problema que resolve:**

- Markdown é legível mas não semântico (sem schema, sem tipos, sem relações)
- Anytype usa formato proprietário encryptado (vendor lock-in)
- Obsidian usa markdown + cache DB proprietário (não portável)

**Solução do Refarm:**

- Todos os dados são JSON-LD antes de persistir
- Compatível com Schema.org, Wikidata, ActivityPub
- Import/export para qualquer sistema RDF (Semantic Web)
- Dados continuam úteis mesmo sem Refarm

**Valor:** Zero vendor lock-in, dados portáteis para sempre.

---

### 3. Nostr como Identidade + Marketplace

**Problema que resolve:**

- SilverBullet requer conta no servidor específico
- Obsidian requer conta Obsidian (centralizada)
- Anytype usa keypair custom (não interoperável)

**Solução do Refarm:**

- Nostr keypair (BIP-39) funciona em qualquer relay
- Plugin discovery via NIP-89/94 (sem servidor central)
- Identidade portátil entre apps Nostr (Amethyst, Damus, etc.)

**Valor:** Identidade soberana, marketplace descentralizado.

---

### 4. Guest Mode (Identity-Orthogonal Storage)

**Problema que resolve:**

- Todos os concorrentes requerem setup inicial: criar vault, escolher pasta, criar conta
- Colaboração requer que todos tenham conta
- Fricção alta para "apenas experimentar"

**Solução do Refarm:**

- Guest mode: zero signup, storage escolhido pelo usuário (ephemeral/persistent/synced)
- Colaborar via WebRTC com código de 6 dígitos
- Upgrade para identidade permanente sem perder dados (rewrite ownership)

**Valor:** Onboarding zero-friction, colaboração sem barreira.

---

## Análise SWOT

### Strengths (Forças)

- **WASM Plugin Sandbox**: Segurança superior aos concorrentes
- **JSON-LD**: Formato aberto, semantic web, zero lock-in
- **Nostr**: Identidade descentralizada, marketplace sem servidor
- **Guest Mode**: Onboarding zero-friction
- **Browser-Only**: Zero install, acessível via URL
- **AGPL-3.0**: Open-source radical, auditável

### Weaknesses (Fraquezas)

- **Maturidade**: v0.1.0, sem usuários ainda
- **Ecossistema**: 0 plugins, 0 themes (precisa criar)
- **Performance**: Não validado em escala (10K+ notes)
- **Mobile**: PWA limitado comparado a apps nativos
- **Marketing**: Sem comunidade, sem awareness
- **Desktop Features**: Sem filesystem watcher, sem global search nativo

### Opportunities (Oportunidades)

- **Semantic Web**: Integração com Wikidata, Schema.org, ActivityPub
- **Nostr Ecosystem**: 10M+ usuários Nostr podem descobrir Refarm via NIP-89
- **WASM Plugins**: Linguagens além de JS (Rust, Go, AssemblyScript)
- **Local-First Movement**: Crescimento do interesse em soberania de dados
- **AI Integration**: WASM plugins podem rodar modelos locais (llama.cpp)
- **Browser Extensions**: Integrar com Web Clipper (próxima discussão)

### Threats (Ameaças)

- **Obsidian Dominance**: 1M+ usuários, network effects, 1700+ plugins
- **SilverBullet Convergence**: Se adotar WASM + Nostr, vira concorrente direto
- **Anytype Funding**: $13M permite acelerar features + UX
- **Browser Limitations**: OPFS quota limits, sem filesystem watcher
- **WASM Maturity**: Component Model ainda em evolução (instável)
- **Nostr Volatility**: Protocol pode mudar, relays podem desaparecer

---

## Recomendações Estratégicas

### Curto Prazo (v0.1.0 - v0.3.0)

1. **Validar Performance**: Benchmark com 10K+ notes, CRDT sync stress test
2. **Plugin SDK**: Criar exemplos de referência (Markdown preview, Kanban, Git sync)
3. **UX Polish**: Guest mode onboarding, keyboard shortcuts, mobile PWA otimização
4. **Documentação**: Tutorial de criação de plugins, arquitetura explicada

### Médio Prazo (v0.4.0 - v0.6.0)

1. **Marketplace MVP**: NIP-89 discovery, plugin install one-click, ratings/reviews
2. **Integrações**: Export para Obsidian/Logseq (markdown), import de JSON
3. **Semantic Features**: SPARQL queries, graph visualization, JSON-LD import
4. **Colaboração Real-time**: WebRTC P2P refinado, presença de usuários

### Longo Prazo (v0.7.0+)

1. **Native Apps**: Electron/Tauri para desktop, Capacitor para mobile (performance)
2. **AI Plugins**: WASM llama.cpp, embeddings locais, semantic search
3. **ActivityPub Bridge**: Publicar notas como posts ActivityPub (Mastodon, etc.)
4. **Browser Extension**: Discussão detalhada no próximo documento

---

## Conclusão

**Refarm ocupa um nicho único:** Browser-based + Open-source + WASM sandboxed + Nostr identity + JSON-LD.

**Nenhum concorrente combina todas essas características.**

- **SilverBullet** é o mais próximo mas usa Deno (menos seguro) + identidade server-bound
- **Obsidian** é líder de mercado mas closed-source + vendor lock-in + plugins inseguros
- **Logseq** é open-source mas desktop-only + sem sandbox + formato markdown puro
- **Anytype** é privacy-first mas closed-source + sem plugins + formato proprietário

**Pergunta crítica:** Esse nicho é grande o suficiente para construir comunidade sustentável?

**Hipótese:** Sim, se focarmos em:

1. **Developers**: Querem hackability + segurança + portabilidade
2. **Privacy Advocates**: Querem soberania de dados + zero vendor lock-in
3. **Semantic Web**: Querem JSON-LD + RDF + interoperabilidade

**Próximo passo:** Validar hipótese com early adopters.

---

## Referências

- [SilverBullet GitHub](https://github.com/silverbulletmd/silverbullet)
- [Obsidian Homepage](https://obsidian.md/)
- [Logseq Homepage](https://logseq.com/)
- [Anytype Homepage](https://anytype.io/)
- [Nostr NIP-89](https://github.com/nostr-protocol/nips/blob/master/89.md)
- [JSON-LD Spec](https://www.w3.org/TR/json-ld11/)
- [WASM Component Model](https://github.com/WebAssembly/component-model)
