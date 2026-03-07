# Discussão: Bootstrap do Design System Headless (Interno + Externo)

**Data**: 2026-03-07  
**Status**: Draft para alinhamento de arquitetura  
**Objetivo**: Definir *quando* bootstrapar a estrutura de design system headless e *como* fazê-lo com sane defaults, acessibilidade e internacionalização desde o início.

---

## Contexto

O Refarm já possui diferenciais técnicos fortes (browser-first, plugins WASM, JSON-LD, identidade soberana). Para transformar isso em vantagem de produto e ecossistema, o design system headless deve ser tratado como infraestrutura de escala, não apenas camada visual.

**Tese**: o bootstrap é inevitável, mas deve ocorrer por gatilhos objetivos para evitar custo antecipado sem adoção real.

---

## O Que Significa "Bootstrap" Neste Cenário

Bootstrap aqui significa estabelecer a fundação mínima de um design system headless para dois públicos:

- **Uso interno**: acelerar entrega do `apps/homestead` e reduzir inconsistência de UX.
- **Uso externo**: permitir que plugins e integradores usem contratos de UI previsíveis sem acoplamento visual ao core.

Escopo de bootstrap (mínimo):

- Biblioteca de primitivas headless (`Button`, `Dialog`, `Menu`, `Tabs`, `Toast`, `FormField`, `Listbox`).
- Contratos de acessibilidade por componente (teclado, foco, ARIA, semântica).
- Infra de i18n por padrão (chaves, fallback, ICU/pluralização).
- Tokens semânticos e tema base (sem impor identidade visual rígida).
- Testes de contrato de interação (não apenas snapshot visual).

---

## Gatilhos de Decisão (Quando Bootstrapar)

Use a matriz abaixo para decidir início formal. Recomendação: iniciar quando houver **3 ou mais gatilhos ativos** ou **1 gatilho crítico**.

### Gatilhos Críticos

1. **Superfície de UI compartilhada entre core e plugins**
- Exemplo: plugins precisam abrir `Dialog`, `Command Palette`, `Settings` com comportamento consistente.

2. **Débito recorrente de acessibilidade e i18n**
- Exemplo: regressões de teclado/foco em PRs, strings hardcoded, falta de fallback de locale.

3. **Onboarding externo com expectativa de extensibilidade de UI**
- Exemplo: início de SDK para parceiros/comunidade plugin-first.

### Gatilhos de Escala

1. **Repetição de padrões em 3+ áreas do produto** (navigation, forms, overlays).
2. **Tempo crescente de revisão UX/a11y por PR** (retrabalho sistemático).
3. **Divergência visual/comportamental entre apps/pacotes**.
4. **Demanda de theming/white-label** por comunidade ou parcerias.
5. **Aumento de contribuições externas** com inconsistência de qualidade de UI.

---

## Modelo de Adoção por Fase

### Fase A (Imediata): Foundation Bootstrap

Objetivo: criar o "chão" técnico sem bloquear roadmap de features.

Entregáveis:

- `packages/ui-headless` com 6-8 primitivas essenciais.
- `packages/ui-tokens` com tokens semânticos (cor, spacing, tipografia, motion).
- Checklist de contrato a11y/i18n por componente (Definition of Done).
- Harness de testes de teclado/foco/ARIA em CI para componentes críticos.

Critério de saída:

- Componentes core do `apps/homestead` já migrados para primitivas headless.
- Novos componentes só entram se seguirem contrato de a11y/i18n.

### Fase B (Curto Prazo): Internal Productization

Objetivo: estabilizar uso interno e reduzir custo de manutenção.

Entregáveis:

- Catálogo interno de padrões (exemplos de composição por caso real).
- Guidelines de copy/translations para chaves compartilhadas.
- Métricas de qualidade: regressão a11y, cobertura de teclado, cobertura de locale.

Critério de saída:

- Tempo de revisão UX/a11y reduzido.
- Queda de bugs de inconsistência entre telas fluxos similares.

### Fase C (Médio Prazo): Externalization

Objetivo: abrir contratos para ecossistema sem congelar design do core.

Entregáveis:

- API pública estável para integradores (`slots`, hooks, estados).
- Documentação para plugin authors: composição sem quebra de acessibilidade.
- Política de versionamento semântico para contratos de UI headless.

Critério de saída:

- Primeiro ciclo de adoção por plugin externo sem forks do core.
- Mudanças breaking controladas por changelog e migração.

---

## Sane Defaults Obrigatórios

Sane defaults não são opcionais neste bootstrap. São parte do contrato.

1. **Acessibilidade**
- Navegação completa por teclado.
- Gestão de foco para overlays e fluxos transientes.
- ARIA e semântica nativa como default.
- Estado de erro/sucesso com feedback perceptível (visual e não-visual).

2. **Internacionalização**
- Todo texto user-facing via chaves de tradução.
- Fallback de locale obrigatório.
- Suporte a pluralização/ICU sem workaround por componente.
- Evitar strings em lógica de negócio.

3. **Headless by Design**
- Comportamento e estado separados de estilo visual.
- Theming via tokens e CSS variables, sem acoplamento a brand única.
- API composta para permitir layout livre sem quebrar contratos.

---

## Riscos de Timing

### Bootstrap cedo demais

- Investimento em abstração antes de padrões reais surgirem.
- API prematura com custo alto de refactor.
- Ritmo de feature delivery pode cair no curto prazo.

### Bootstrap tarde demais

- Divergência de UX e crescimento de débito estrutural.
- Retrabalho massivo para corrigir a11y/i18n depois.
- Fricção para abrir ecossistema externo (plugins inconsistentes).

**Estratégia recomendada**: fasear bootstrap em paralelo ao roadmap, com escopo mínimo obrigatório e critérios de avanço explícitos.

---

## Métricas de Prontidão

Monitorar mensalmente:

- `% de componentes novos com contrato a11y completo`.
- `% de strings internacionalizadas vs hardcoded`.
- `tempo médio de revisão de UI por PR`.
- `número de regressões de foco/teclado por release`.
- `número de componentes duplicados com semântica equivalente`.

Sinal de alerta para iniciar/expandir bootstrap:

- 2 releases seguidas com regressão a11y/i18n relevante.
- Crescimento de duplicação de componentes acima de 20% por ciclo.
- Início de distribuição de SDK/UI para terceiros.

---

## Mapeamento na Arquitetura de Documentação

Onde este tema deve ser refletido:

- `docs/research/design-system-bootstrap-discussion.md`
  - Discussão estratégica, gatilhos e critérios de timing.
- `docs/A11Y_I18N_GUIDE.md`
  - Contratos normativos de acessibilidade e i18n para componentes.
- `docs/ARCHITECTURE.md`
  - Posicionamento dos pacotes `ui-headless` e `ui-tokens` na arquitetura em camadas.
- `roadmaps/MAIN.md`
  - Milestones de fase A/B/C com gates de qualidade explícitos.
- `specs/ADRs/`
  - ADR recomendado: "Headless UI Contract and Token Strategy".

---

## Recomendação Objetiva

Dado o posicionamento do Refarm e a ambição de ecossistema, o bootstrap do design system headless é **necessário e inadiável no nível fundacional**.

Decisão prática sugerida:

1. Iniciar **Fase A** imediatamente com escopo mínimo (sem tentar resolver todo o sistema visual).
2. Tratar a11y/i18n como *quality gate* de componente, não como hardening posterior.
3. Planejar externalização apenas após estabilização interna dos contratos (Fase B concluída).

Isso preserva velocidade no curto prazo e evita dívida estrutural que bloquearia uso interno e externo no médio prazo.
