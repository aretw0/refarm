# Spin Synergy - Roadmap (Estratificação Soberana)

**Current Version**: v0.1.0 (Tractor Native Graduated)  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Architectural Alignment (DONE)
**Scope**: Estudo aprofundado do Spin v3 Factors e dependências cross-linguagem, validando a arquitetura existente do Refarm.  
**Gate**: `docs/research/spin-synergy.md` concluído com a visão estratégica de **Estratificação Soberana**.

---

## v0.2.0 - Runtime Factorizado & Alvos de Deploy Seletivo
**Scope**: Evoluir o host `tractor` para uma arquitetura de "Factors" modulares e expandir o suporte para múltiplos alvos de execução (Browser Service Workers e Local Daemons).  
**Depends on**: Estabilidade do `wasmtime` component-model e suporte a JCO para execução no browser.

### SDD (Spec Driven)
- [ ] ADR-050: Arquitetura de Host Factorizado para o `tractor`, detalhando a transição para interfaces WIT/WASI padronizadas.
- [ ] Spec: Definição de interfaces Factor para `wasi:key-value`, `wasi:http`, e `refarm:storage`.
- [ ] Spec: Estratégia de **Deploy Seletivo** no SDK do Refarm, permitindo ao desenvolvedor marcar plugins para execução no Browser, Edge ou Daemon.
- [ ] Spec: Integração de observabilidade via `wasi:observe`.

### BDD (Behaviour Driven)
- [ ] Integração: Habilitar/Desabilitar capacidades específicas do host via configuração.
- [ ] Integração: O mesmo plugin WASM sendo carregado no `tractor` (Rust) e no `homestead` (Browser via JCO).
- [ ] Aceitação: Plugin marcando dependências seletivas baseadas no alvo de deploy (ex: usar storage local no daemon vs OPFS no browser).
- [ ] Aceitação: Exportação de métricas/traces de um plugin para um coletor local via `wasi:observe`.

### TDD (Test Driven)
- [ ] Unit: Testes para `FactorManager` e o ciclo de vida dos Factors.
- [ ] Unit: Testes de isolamento para múltiplos alvos de execução.
- [ ] Cobertura: ≥80%

### DDD (Domain Implementation)
- [ ] Domain: Refatoração do core do host `tractor` para suportar a arquitetura de Factors.
- [ ] Infra: Implementação de `StorageFactor`, `HttpFactor`, `CryptoFactor` utilizando interfaces WASI/WIT.
- [ ] Infra: Suporte a Service Worker no SDK do Refarm para carregar plugins WASM como componentes de background.
- [ ] Infra: Implementação de `OTelFactor` para observabilidade nativa.

---

## v0.3.0 - Composição de Componentes & Orquestração Dinâmica
**Scope**: Habilitar a composição de componentes e a orquestração dinâmica de plugins entre camadas da soberania.

- [ ] Implementação de **Runtime Linking**: Resolução e linkagem dinâmica de componentes WASM no startup.
- [ ] Suporte para **Plugins Nativos Multi-linguagem**: Invocação direta de componentes Python/JS a partir do host Rust.
- [ ] Implementação de **Orquestração Dinâmica**: O sistema decide em tempo de execução se um componente deve rodar localmente ou no daemon baseado em latência e carga.
- [ ] Suporte para **Distribuição de Plugins baseada em OCI**: Utilização de padrões `wkg` e `spin deps` para o registro e distribuição de plugins no Refarm.

---

## Notes
- Baseado na pesquisa estratégica: [Research: Spin v3 Synergy Analysis](../../docs/research/spin-synergy.md).
- O foco principal é a **Estratificação Soberana**: O mesmo binário WASM rodando onde for mais eficiente para o usuário.
- A convergência com o Spin v3 é feita através da adoção de padrões da [Bytecode Alliance](https://bytecodealliance.org).
