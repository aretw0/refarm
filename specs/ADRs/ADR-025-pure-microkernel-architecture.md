# ADR-025: Pure Microkernel Architecture for Tractor

**Date**: 2026-03-07
**Status**: Proposed
**Context**:
O `Tractor` (antigo Kernel) foi concebido para ser a **maquinaria pesada** que cultiva o "Solo Fértil" (a camada de dados JSON-LD) do Refarm. A filosofia central do projeto é "Tudo é um Plugin" e a independência das primitivas. No entanto, a implementação inicial do `TractorConfig` e o método `Tractor.boot()` violaram esse princípio ao importar e instanciar diretamente implementações específicas de domínio: `OPFSSQLiteAdapter`, `NostrIdentityManager` e `SyncEngine`.

Isso gerou um acoplamento indesejado: o Tractor passou a "saber" o que é Nostr (exigindo `nostrRelays` no seu config), o que é SQLite e o que é CRDT. Num modelo de microkernel verdadeiro, o núcleo não deve saber nada sobre as implementações de armazenamento, identidade ou sincronização; ele deve apenas definir as "portas" (interfaces) e permitir que os "adaptadores" sejam plugados.

**Decision**:
Vamos refatorar o `Tractor` para ser um microkernel puro, agnóstico em relação a implementações.

1. **Inversão de Controle (IoC) no Boot:** O método `Tractor.boot(config)` deixará de instanciar o banco de dados ou o gerenciador Nostr. O `config` exigirá instâncias que obedeçam às interfaces dos contratos (`StorageContract`, `IdentityContract`, `SyncContract`).
2. **Configuração Limpa:** O `TractorConfig` removerá campos como `dbName`, `nostrRelays` e `syncEnabled`. O Tractor não precisa saber o nome do banco de dados OPFS; quem precisa saber isso é o adaptador SQLite que é instanciado fora do Tractor e passado para dentro dele.
3. **Plataforma como Orquestrador:** O Tractor focará exclusivamente no sandboxing seguro (WASM), normalização de JSON-LD e roteamento das chamadas WIT para os adaptadores fornecidos via configuração.

**Consequences**:
- **Positivas:** 
  - Restaura a pureza da arquitetura do Tractor.
  - Facilita testes unitários massivamente (podemos passar adaptadores em memória para o Tractor sem invocar SQLite).
  - Garante que a promessa "If Refarm disappears, every primitive keeps working on its own" seja simétrica: o Tractor também pode ser executado com *outras* primitivas (ex: um adaptador de armazenamento na nuvem, ou identidade via Ethereum ao invés de Nostr).
- **Negativas:** 
  - A inicialização na Homestead exigirá mais *boilerplate*. O "consumidor" (Homestead) terá que importar e instanciar os adaptadores do SQLite e Nostr manualmente para então passá-los para o `Tractor.boot()`. (Este é um trade-off aceitável e comum em padrões de Injeção de Dependência).

**Proof of Status**:
Aprovado durante revisão arquitetural pós-renomeação devido ao desalinhamento com SDD.
