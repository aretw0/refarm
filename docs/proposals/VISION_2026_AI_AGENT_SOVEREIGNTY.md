# Vision 2026: AI Agent Sovereignty

> "O Refarm não é apenas uma base de dados; é um assistente autônomo que constrói sua própria infraestrutura sob demanda."

## A Estrela do Norte (The North Star)

O objetivo final do Refarm é a transição de um **Sistema Operacional de Dados** para um **Agente Soberano de Execução**. Nesta visão, o usuário não apenas armazena dados, mas interage com um Agente (ao estilo Claude Code) que possui agência total sobre o ambiente Refarm.

> [!NOTE]
> Para entender como o Agente se orienta e aprende padrões, veja a **[Sinergia com o TEM (Cognitive Map)](./SYNERGY_AI_AGENT_TEM.md)**.

### 1. O Pipeline: Onboarding → Agente
O primeiro contato de um novo usuário com o Refarm deve ser um processo de "descobrimento arquitetural". 
- **Entrada**: O usuário descreve seus processos, dores e a topologia de dados desejada.
- **Saída**: O onboarding culmina na configuração de um **Plugin de IA customizado**, que já conhece o contexto do usuário e as ferramentas (blocks) disponíveis no ecossistema.

### 2. Criação em Tempo de Execução (Runtime Synthesis)
Diferente de IDEs tradicionais, o Agente Refarm opera dentro do sandbox. Ele tem a capacidade de:
- **Gerar Interfaces**: Criar componentes Astro/React/Vanilla e injetá-los no Homestead instantaneamente.
- **Gerar Plugins (WASM)**: Escrever lógica de negócio, compilar para WASM (via um serviço de build soberano ou local) e instalar no Tractor sem reiniciar o sistema.
- **Projetar Projetos**: Levantar novas "Distros" ou "Blocks" para resolver problemas específicos do usuário.

### 3. Pilares Técnicos Necessários

Para que essa visão se torne realidade, precisamos consolidar os seguintes avanços:

| Pilar | Descrição | Status |
|---|---|---|
| **Tractor-Rust Native** | Motor de orquestração em Rust para rodar em dispositivos de 10MB e edge, permitindo execução de modelos locais de forma eficiente. | 🏗️ *Roadmap* |
| **WIT Inference Standard** | Uma interface padronizada no SDK do Refarm para que qualquer plugin possa solicitar inferência/completion ao Tractor. | 💡 *Proposta* |
| **Hot-WASM Swapping** | Capacidade do Tractor de atualizar o grafo de plugins em tempo de execução sem perda de estado. | 🧪 *Pesquisa* |
| **Sovereign Source-to-Binary** | Um plugin capaz de transformar código (TS/Rust) em binários WASM dentro do próprio ambiente Refarm. | 🔭 *Visão* |

### 4. O Agente como "Cidadão de Primeira Classe"
O Agente não vive em um chat separado; ele é um **Plugin Soberano** com permissões de `capability-based security` elevadas, capaz de ler o Grafo Soberano e propor "Reforma de Dados" e "Refatoração de Infraestrutura" continuamente.

---
> Esta reflexão serve como bússola para os Sprints de 2026, movendo o Refarm de um "Fertile Soil" para um "Autonomous Sovereign Agent".

## Concrete Meaning: "AI as Syscall"

In traditional systems, AI calls are network requests to external APIs (`POST /api/completions`). In the Refarm sovereign vision, AI inference is a **WASI interface** — a capability the tractor host exposes to plugins, the same way it exposes `wasi:filesystem` or `wasi:http`.

This means:

```wit
// Proposed: ai-inference-contract-v1.wit
interface inference {
  record completion-request {
    prompt: string,
    max-tokens: u32,
    temperature: float32,
  }

  record completion-response {
    text: string,
    tokens-used: u32,
    model-id: string,
  }

  complete: func(request: completion-request) -> result<completion-response, string>
  embed: func(text: string) -> result<list<float32>, string>
}

world ai-capable-plugin {
  import inference
  include refarm-plugin
}
```

A plugin with `import inference` calls `tractor.infer(prompt)` — no network, no API key, no external dependency. The tractor host routes the call to whatever local model is loaded (WebLLM, ONNX, llama.cpp via Rust).

---

## Contracts Required Before AI Syscalls

These contracts must be stable before the AI inference WIT can be added:

| Contract | Status | Blocks |
|----------|--------|--------|
| `refarm-sdk.wit` (base plugin WIT) | ✅ Stable | — |
| `storage-contract-v1` | ✅ Ready, unpublished | v0.1.0 gate |
| `sync-contract-v1` | ✅ Ready, unpublished | v0.1.0 gate |
| `ai-inference-contract-v1` | ❌ Proposed only | Post v0.1.0 |
| TEM plugin (WASM) | ❌ Blueprint stage | `noveltyScore` primitive |

---

## Dependency Graph

```
Tractor-Rust Native ✅ (ADR-048, graduated 2026-03-19)
    └── v0.1.0 contracts published (@refarm.dev scope)
            └── TEM plugin → WASM (migrate from TS)
                    └── ai-inference-contract-v1 (WIT interface)
                            └── WebLLM / ONNX as WASI host primitive
                                    └── AI Agent Sovereignty (Vision 2026)
```

---

## Updated Technical Pillars Status

| Pilar | Descrição | Status |
|---|---|---|
| **Tractor-Rust Native** | Motor em Rust para edge e dispositivos sem Node.js | ✅ **DONE** (ADR-048) |
| **WIT Inference Standard** | Interface padronizada para inferência como WASI primitive | 💡 *Proposta* (see `ai-inference-contract-v1` above) |
| **Hot-WASM Swapping** | Atualizar grafo de plugins sem perda de estado | 🧪 *Pesquisa* |
| **Sovereign Source-to-Binary** | Plugin que compila TS/Rust → WASM dentro do Refarm | 🔭 *Visão* |
| **TEM Plugin (WASM)** | Cognitive map como WASM plugin para o tractor host | 🏗️ *Blueprint* (see `packages/plugin-tem/docs/ARCHITECTURE.md`) |

---

## Prerequisites Summary

To make this vision real:
1. ✅ Dual-runtime tractor (TS + Rust) — **DONE**
2. Publish v0.1.0 contracts to `@refarm.dev` npm scope
3. Migrate `plugin-tem` from TypeScript to WASM plugin
4. Define `ai-inference-contract-v1` WIT interface
5. Implement WebLLM/ONNX as tractor host provider (Rust: `llama.cpp` bindings via WASI; Browser: WebLLM Worker)
6. Build the Agentic onboarding flow on top of steps 1–5
