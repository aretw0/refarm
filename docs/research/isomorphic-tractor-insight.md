# Architectural Insight: Isomorphic Tractor & Hybrid Synergy

**Context**: 
Discussão sobre o uso do Refarm em modo **Astro Hybrid** (SSR + Client-side).

## A Visão "Isomórfica"
Graças à arquitetura de **Microkernel (Astro Tractor)** e **Adaptadores**, o Refarm pode rodar exatamente o mesmo código de orquestração tanto no Servidor (Edge Workers, Node.js, Deno) quanto no Cliente (Browser).

### Cenário Híbrido:
1.  **Servidor (SSR)**: O Astro recebe uma requisição. Ele faz o `boot()` do Tractor usando um `PostgresAdapter` (conectado a um banco de dados real em nuvem ou PGlite no Edge). Ele renderiza o Grafo Soberano em HTML para SEO e performance instantânea.
2.  **Cliente (Hydration)**: O navegador carrega o JS. O Tractor faz o `boot()` usando o `OPFSSQLiteAdapter`. Ele sincroniza os dados via CRDT e permite edições offline.

## Caveats (Choque de Realidade)

### 1. Dialetos SQL (Resolvido!)
Conforme documentado no [ADR-026](../ADRs/ADR-026-externalized-storage-migrations.md), externalizamos o esquema físico para o contrato `@refarm.dev/storage-contract-v1`. O Tractor não emite mais SQL; ele apenas solicita que o adaptador garanta a conformidade do esquema.

### 2. Runtime de Plugins (Implementado)
O `PluginHost` agora usa o contrato `@refarm.dev/plugin-manifest` para garantir integridade e agnosticismo de descoberta.

## Conclusão
Essa sinergia foi validada arquiteturalmente nesta refatoração. O Tractor agora é 100% puro e agnóstico, fornecendo a base necessária para habilitar o **Astro Hybrid** com confiança técnica.

---

## 🦾 Evolução: O Futuro dos Plugins Isomórficos

### Single Binary, Dual Context (A Visão Astro)
Não queremos que o desenvolvedor tenha que nos dar dois plugins. O objetivo é a **Simetria de Lógica**:

1.  **O Mesmo .wasm**: O desenvolvedor compila um único binário WASM.
2.  **Primitivas de Ambiente**: O Tractor expõe no contrato WIT funções como `is-server() -> bool`.
3.  **Execução Simétrica**:
    *   **No Servidor**: O plugin roda para `ingest()` (webhooks) ou "pre-render" (SSR).
    *   **No Cliente**: O mesmo plugin roda para interações em tempo real e persistência local (OPFS).

Isso segue a filosofia do Astro: o desenvolvedor escreve a lógica uma vez, e o "compilador" (no nosso caso, o Linker do Tractor) garante que as peças certas se encaixem no runtime correto.
