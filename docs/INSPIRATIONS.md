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

### 🌐 The Lineage of the Sovereign Graph

O conceito de "Graph-as-Code" e a abordagem "Ontology-First" do Refarm são a culminação moderna de décadas de pesquisa em ciência da computação.

- **[Douglas Engelbart (Augmenting Human Intellect)](https://dougengelbart.org)**: Pela visão de 1962 de computadores não como "calculadoras", mas como ferramentas para *aumentar o intelecto humano*. Seu trabalho no **NLS** é o ancestral espiritual do nosso microkernel colaborativo.
- **[Ted Nelson (Project Xanadu)](https://xanadu.com)**: Pelos conceitos de **Transclusão** e links bidirecionais. A visão de Nelson de um repositório interconectado profundo e resiliente é o que buscamos com o Sovereign Graph.
- **[The Semantic Web / RDF](https://w3.org/RDF/)**: Pela formalização da tripla "Sujeito-Predicado-Objeto". O modelo de dados do Refarm é um descendente direto do objetivo da Web Semântica de tornar os dados legíveis por máquinas e portáteis.
- **[Smalltalk / Object-Oriented Programming](https://wildfire.com/smalltalk)**: Pela filosofia de "Everything is an Object" e *late-binding*. A forma como tratamos nós como entidades vivas com seus próprios esquemas (Ontology-first) deve muito à visão da Smalltalk de computação como um sistema de células comunicantes.

### 🧠 Knowledge & Networked Thought

- **[Roam Research](https://roamresearch.com)**: Pela revolução dos grafos e popularização de links bidirecionais ao nível de bloco.
- **[Obsidian](https://obsidian.md)**: Por provar que "Local-First" e arquivos baseados em markdown são o alicerce da soberania digital.
- **[Logseq](https://logseq.com)**: Pelo compromisso com grafos open-source e outliners focados em privacidade.

### 🚜 Personal Lineage

- **[trellis (aretw0/trellis)](https://github.com/aretw0/trellis)**: O predecessor direto do Refarm. Grande parte da nossa lógica de "Graph-as-Code" e automação nasceu dos experimentos pessoais do criador em automatizar o "solo digital".

### 📊 Storage & Data

- **[SQLite](https://sqlite.org)**: For the most reliable and portable database on Earth.
- **[vlcn.io (cr-sqlite)](https://vlcn.io)**: For the breakthrough in making relational databases natively CRDT-aware. This is the cornerstone of our offline-first synchronization strategy.
- **[PGLite](https://pglite.dev)**: For proving that we can run full-featured PostgreSQL in the browser for advanced vector search and AI local-first capabilities.

---

> "We are building a farm, but we are also cultivating a digital estate that respects the lineage of those who built the tools that made it possible."

Thank you to all the contributors and maintainers of these projects.
