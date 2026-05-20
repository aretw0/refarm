# Análise Arquitetural: Refarm vs. wasmCloud

wasmCloud é o sistema de computação distribuída sobre WASM Component Model mais battle-tested em produção. Este documento mapeia seus conceitos para o Refarm — identificando o que absorvemos, onde divergimos intencionalmente, e o que ainda não fizemos mas sabemos que precisamos.

## Tabela de equivalência

| Conceito wasmCloud | Conceito Refarm | Status | Observação |
|--------------------|-----------------|--------|------------|
| **Lattice** | `BackendDescriptor` + `ManagedBackend` | 🚧 Em design | wasmCloud: flat topology de hosts via NATS. Refarm: qualquer processo que satisfaça o protocolo HTTP é um backend. Mesmo princípio, transporte diferente. |
| **Host como protocolo** | `BackendDescriptor` | 🚧 Em design | O host wasmCloud pode ser implementado em qualquer linguagem (Go, Python, JS) desde que fale o protocolo de lattice. Nossa spec do Backend Protocol codifica o mesmo: farmhand é uma implementação, não o protocolo. |
| **Link Definitions** | `requires/providesApi` em `plugin-manifest` | ⚠️ Parcial | wasmCloud: fiação explícita `componente → provider` por interface WIT, validada pelo host no boot. Refarm: declarativo no manifest, mas o runtime não valida a fiação antes de carregar. Evolução necessária. |
| **Providers** | Plugins carregados pelo `tractor` | ✅ Implementado | Capability providers no wasmCloud são componentes de primeira classe (WASM ou nativos). No Refarm, tractor carrega providers como WASM via JCO. Tier 1 (JS local) é um atalho antes da maturidade WASM completa. |
| **`wash` CLI** | `refarm plugin`, `refarm extension`, futuro `refarm component` | 🚧 Evoluindo | `wash build`, `wash dev`, `wash deploy` são o benchmark de DX para componentes WASM. O `wash dev` com live-reload Rust é onde precisamos chegar. |
| **`wash dev` loop** | `/reload` no REPL + `refarm extension new` | ⚠️ Parcial | wasmCloud: rebuild automático ao salvar Rust + hot-deploy no host. Refarm: `/reload` funciona para JS local. Para WASM, ainda não há rebuild automático. |
| **Policy Service** | `heartwood` + `TrustManager` + `PluginRegistry` | ✅ Implementado (local) | wasmCloud tem um policy service separado consultado pelo host por chamada. Refarm valida no load (não por chamada) e cobre bem o caso local. |
| **Host-level capability routing** | `globalThis.__REFARM_PLUGIN_IMPORTS__` | ⚠️ Parcial | wasmCloud roteia chamadas WIT para o provider correto automaticamente. Refarm injeta imports via globalThis — funciona, mas não é routing declarativo. |

## Onde divergimos intencionalmente

| Decisão | wasmCloud | Refarm | Razão |
|---------|-----------|--------|-------|
| **Transport do Lattice** | NATS (distribuído, broker-based) | HTTP + SSE (local, direto) | Complexidade zero para o caso de uso principal. NATS seria overhead sem ganho no caso single-node. |
| **Link Definitions** | Explícitas, validadas no boot pelo host | Implícitas via manifest (Fase 2 para validação explícita) | DX first — não bloquear o usuário com fiação manual. A validação rigorosa vem quando a superfície estabilizar. |
| **Todo componente é WASM** | Sim — sem exceção | Não — Tier 1 permite JS local sem build | O DX de "escreva e use agora" importa mais que pureza arquitetural no onboarding. Tier 3 é a promoção para WASM. |
| **Multi-host nativo** | Core do produto — o Lattice é a primitiva | Fase 2 — um host por projeto primeiro | Resolver o caso simples corretamente antes de resolver distribuição. |
| **Governance** | Corporativa (Cosmonic → wasmCloud Inc) | Soberana por design | Decisão de valores, não técnica. |

## O que ainda não fizemos, mas sabemos que precisamos

Itens que o wasmCloud provou que funcionam e que o Refarm ainda não implementou:

**Link Definitions explícitas em boot-time**
Hoje: o `ManagedBackend.ensureReady()` não valida se todos os `requires` de um componente têm providers registrados antes de retornar o handle.
Meta: `ensureReady()` inspeciona o backend e falha cedo com mensagem clara se um provider declarado está ausente.

**`refarm component dev` — o equivalente de `wash dev`**
Hoje: `/reload` funciona para extensões JS locais. Para WASM, o developer precisa rebuildar manualmente e reiniciar o farmhand.
Meta: `refarm component dev` observa arquivos Rust, dispara `cargo build --target wasm32-wasip2`, e emite `/reload` automaticamente.

**Host discovery antes de carregar um componente**
Hoje: o tractor descobre que um provider está faltando em runtime (erro no `import`).
Meta: o host sabe quais providers estão disponíveis antes de tentar carregar um componente — fail-fast com diagnóstico.

**Routing declarativo de capabilities**
Hoje: `globalThis.__REFARM_PLUGIN_IMPORTS__` injeta todos os imports de uma vez. Não há routing seletivo por interface.
Meta: o host roteia chamadas WIT por interface name — um componente que declara `requires: ["ai:respond"]` recebe exatamente o provider que expõe essa interface, sem precisar conhecer a implementação.

## Conclusão

wasmCloud é o que a indústria validou para WASM distribuído em produção. Refarm é o que queremos que exista para o developer soberano local. Contextos opostos — mas os primitivos que eles acertaram (host como protocolo, Link Definitions, Providers como primeira classe, developer CLI integrado) são os mesmos que precisamos dominar.

Estudamos wasmCloud não para copiar, mas para não reinventar o que já foi errado e corrigido, e para saber exatamente quando e por que divergimos.
