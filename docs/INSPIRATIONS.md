# Inspirations & Homage

Refarm stands on the shoulders of giants. Our architecture, security model, and philosophy are deeply inspired by specialized projects that have pushed the boundaries of digital sovereignty, productivity, and trust.

This document is a tribute to the "Greats" we've learned from.

---

### 🛡️ Security & Trust

- **[Matrix / Element](https://matrix.org)**: For the pioneering work on decentralized E2EE, cross-signing, and the Short Authentication String (SAS) verification protocol. Our 7-emoji trust flow is a direct homage to their vision of secure, user-friendly verification.
- **[Nostr](https://nostr.com)**: For demonstrating the power of simple, key-based decentralized identity. Refarm's "Sovereignty First" approach and the use of the `did:nostr` bridge are driven by their minimalist and resilient design.
- **[ProtonMail / ProtonDrive](https://proton.me)**: For setting the gold standard for "Zero-Knowledge" and privacy-by-default applications. We strive for "Proton-level" security in every node we sign.
- **[@paulmillr (Noble Cryptography)](https://github.com/paulmillr)**: For providing high-quality, audited, and strictly-typed cryptographic primitives in JavaScript. Our implementation of Ed25519 and SHA-256 wouldn't be as robust without the Noble libraries.

### 🏗️ Architecture & Extensibility

- **[VS Code](https://code.visualstudio.com)**: For the ultimate masterclass in microkernel architecture, plugin governance, and the "Command Palette" experience. Our `CommandHost` and extension model are built following their success in balancing power and stability.
- **[Wasmtime / Bytecode Alliance](https://bytecodealliance.org)**: For the WASM Component Model and the "Componentize" vision. Their work on WASI and WIT is what makes our `Heartwood` security kernel and untrusted plugin sandboxing possible.
- **[Vim](https://www.vim.org)**: For teaching the world that the keyboard is the fastest interface for the human mind. Refarm's intent-centric navigation aims to bring that "flow state" to every digital task.
- **[SilverBullet](https://silverbullet.md/)**: For the concept of a "Self-Extending" workspace built entirely on Markdown. Their architecture of **"Plugs"** (plugins that run anywhere) communicating with the host via **"Syscalls"**, combined with programmable notes via Lua, is a huge inspiration. It proves that an application can be dynamically extended by the user on the fly without breaking the core engine.
- **[Spin (Fermyon)](https://spinframework.dev/)**: For its "Component-First" approach to WebAssembly. Spin v3's work on **Spin Factors** and cross-language component dependencies mirrors our vision for `tractor`. They are setting the standard for how high-level capabilities should be exposed to sandboxed Wasm components.
- **[zwasm (ClojureWasm)](https://github.com/clojurewasm/zwasm)**: A production-ready (~1.2 MB) WebAssembly Component Model runtime written in Zig. Full WASI P2 + WIT support, 100% spec conformance (62k tests). The technical foundation for the Refarm **Pi-Nano** host — our lightweight Zig-based tractor for edge and resource-constrained environments. Proves that the Component Model doesn't require a heavy JIT runtime.
- **[nullclaw](https://github.com/nullclaw/nullclaw)**: An AI assistant infrastructure framework written in Zig — 678 KB static binary, <2ms boot, 50+ AI providers, pluggable channels and memory backends. The closest thing to "Pi agent written in Zig." A direct reference for how the Refarm sovereign CLI agent should be designed: minimal footprint, fast startup, provider-agnostic.

### 🌐 The Lineage of the Sovereign Graph

O conceito de "Graph-as-Code" e a abordagem "Ontology-First" do Refarm são a culminação moderna de décadas de pesquisa em ciência da computação.

- **[Douglas Engelbart (Augmenting Human Intellect)](https://dougengelbart.org)**: Pela visão de 1962 de computadores não como "calculadoras", mas como ferramentas para _aumentar o intelecto humano_. Seu trabalho no **NLS** é o ancestral espiritual do nosso microkernel colaborativo.
- **[Ted Nelson (Project Xanadu)](https://xanadu.com)**: Pelos conceitos de **Transclusão** e links bidirecionais. A visão de Nelson de um repositório interconectado profundo e resiliente é o que buscamos com o Sovereign Graph.
- **[The Semantic Web / RDF](https://w3.org/RDF/)**: Pela formalização da tripla "Sujeito-Predicado-Objeto". O modelo de dados do Refarm é um descendente direto do objetivo da Web Semântica de tornar os dados legíveis por máquinas e portáteis.
- **[Smalltalk / Object-Oriented Programming](https://wildfire.com/smalltalk)**: Pela filosofia de "Everything is an Object" e _late-binding_. A forma como tratamos nós como entidades vivas com seus próprios esquemas (Ontology-first) deve muito à visão da Smalltalk de computação como um sistema de células comunicantes.

### 🧠 Knowledge & Networked Thought

- **[Roam Research](https://roamresearch.com)**: Pela revolução dos grafos e popularização de links bidirecionais ao nível de bloco.
- **[Obsidian](https://obsidian.md)**: Por provar que "Local-First" e arquivos baseados em markdown são o alicerce da soberania digital.
- **[Logseq](https://logseq.com)**: Pelo compromisso com grafos open-source e outliners focados em privacidade.
- **[Toeverything / AFFiNE](https://github.com/toeverything)**: Por liderarem a fronteira de CRDTs, Rust e WASM na construção de arquiteturas "Local-First". Projetos como OctoBase e os utilitários descentralizados em Rust mostram como construir motores sólidos e performáticos que servem de forte inspiração para o pacote `tractor` e `sync-loro` do Refarm.

### 🤖 Agente Soberano & Runtime Mínimo

Inspirações que moldaram a visão do **Pi Agent** e da arquitetura de ferramentas atômicas (read, write, edit, bash) dentro do ecossistema Refarm.

- **[Claude Code (Anthropic)](https://www.anthropic.com/claude-code)**: Pelo design minimalista de um coding agent orientado a terminal que expõe exatamente 4 ferramentas atômicas ao LLM — `read`, `write`, `edit`, `bash`. Esta filosofia de composição sobre ferramenta única é a pedra angular do **Pi Agent** do Refarm. A demonstração de que ferramentas estruturadas (argv[], sem interpolação de shell) e sandboxing de capabilities podem coexistir com produtividade máxima é o modelo que nos guia.

- **[Zig Language](https://ziglang.org)**: Pela visão de um sistema de controle de memória explícito sem GC, com footprint binário mínimo (~KB vs MB) e compilação cruzada de primeira classe. O princípio "No hidden control flow" do Zig é o que buscamos no host Pi-Nano: nada acontece que o programador não pediu explicitamente. Inspiração para a estratégia de runtime ultra-leve para dispositivos onde wasmtime (~27 MB) não cabe.

- **[Babashka / Clojure no JVM & WASM](https://babashka.org)**: Por provar que Clojure pode rodar como script rápido sem startup do JVM. A trajetória Babashka → ClojureScript → WASM (via WasmGC) é o caminho que enxergamos para a lógica reflexiva e funcional do Pi Agent guest. A semântica imutável do Clojure é ideal para processamento de dados no sandbox — o guest nunca muta estado externo, apenas retorna resultados.

- **[zwasm / ClojureWasm](https://github.com/babashka/babashka)**: Pela pesquisa em compilar ClojureScript para WASM via WasmGC, abrindo a possibilidade de um guest com semântica funcional pura e reflexão de macros em tempo de execução. Nossa estratégia de bridge JSON-over-streams (enquanto WasmGC madurece) é diretamente informada pelo estado atual desta fronteira.

- **[Capability-based Security (WASI)](https://github.com/WebAssembly/WASI)**: Pelo modelo de capability-based security que elimina ambient authority. Toda permissão do Pi Agent — `read-fs`, `write-fs`, `spawn-shell` — é declarada no manifest e concedida explicitamente pelo TrustManager. Nenhum plugin tem acesso a recursos não declarados. O WASI é o sandbox que torna o Pi Agent seguro por construção.

### 🧪 Backlog de influências (em estudo)

- **[claude-mem (aretw0)](https://github.com/aretw0/claude-mem)**: Referência candidata para memória operacional de agente e recuperação de contexto entre sessões. Estudo pendente no backlog para avaliar encaixe com `session-contract-v1` e `task-contract-v1` sem acoplamento indevido.

### 🚜 Personal Lineage

- **[trellis (aretw0/trellis)](https://github.com/aretw0/trellis)**: O predecessor direto do Refarm. Grande parte da nossa lógica de "Graph-as-Code" e automação nasceu dos experimentos pessoais do criador em automatizar o "solo digital".

### 📊 Storage & Data

- **[Loro (loro-dev)](https://loro.dev)**: For the most elegant CRDT library in the
  JavaScript/WASM ecosystem. Their Rust-core + WASM architecture, `LoroTree` with concurrent
  move cycle detection, shallow snapshots analogous to `git clone --depth=1`, and built-in
  time travel (`revertTo`, `forkAt`) are the engine behind Refarm's local-first sovereign graph.
  Special gratitude to the loro-dev community for making collaborative data structures accessible
  without sacrificing correctness or performance. Refarm's CRDT synchronization layer — and the
  CQRS pattern pairing `LoroDoc` with SQLite — would not be possible without their extraordinary
  open-source work. See [ADR-045](../specs/ADRs/ADR-045-loro-crdt-adoption.md).

- **[SQLite](https://sqlite.org)**: For the most reliable and portable database on Earth.
- **[vlcn.io (cr-sqlite)](https://vlcn.io)**: For the breakthrough in making relational databases natively CRDT-aware. This is the cornerstone of our offline-first synchronization strategy.
- **[PGLite](https://pglite.dev)**: For proving that we can run full-featured PostgreSQL in the browser for advanced vector search and AI local-first capabilities.

---

> "We are building a farm, but we are also cultivating a digital estate that respects the lineage of those who built the tools that made it possible."

Thank you to all the contributors and maintainers of these projects.
