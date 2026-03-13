# Reflexão Arquitetural: Estratégia de Distros e Deployment

Este documento mapeia as reflexões e decisões sobre o papel das "distros" no ecossistema Refarm e como elas se relacionam com a infraestrutura de CI/CD.

## Contexto das Distros

O sistema Refarm é cultivado como um conjunto de **packages** (Tractor, Homestead SDK, etc.) que são orquestrados em **apps** (distros). Atualmente identificamos três distros principais:

1. **Refarm.dev (Studio/IDE)**: Focada em desenvolvedores e criadores de plugins.
2. **Refarm.me (Citizen Hub)**: Focada no uso pessoal e soberano do cidadão.
3. **Refarm.social (Social)**: Futura distro para interações e descoberta.

## Reflexão 1: Unificação Estático vs. App (Refarm.dev)

**Pergunta**: Devemos ter dois apps separados para o `dev` (um estático/cartão de visitas e um Studio grande) ou um pode vir do outro?

**Análise**:
O Refarm segue o princípio do **Sovereign Bootloader** (ADR-036), sendo estritamente SSG/SPA. Usamos **Astro** para as distros.

O Astro é ideal para unificar esses mundos:
- A **Landing Page (`/`)** e a **Documentação** podem ser geradas de forma estática (SSG) com performance máxima.
- O **Studio/IDE (`/studio`)**, apesar de complexo, ainda é uma SPA que roda Inteiramente no browser.

**Recomendação**: **O estático deve vir do `dev` naturalmente.**
Manter um único app `apps/dev` para o domínio `refarm.dev` reduz a sobrecarga de manutenção e garante uma identidade visual e de DX (Developer Experience) consistente. O "cartão de visitas" é simplesmente a página inicial do Studio.

## Reflexão 2: Limitações do GitHub Pages e Multi-Cloud

**Contexto**: O GitHub permite apenas uma URL publicada por repositório (refarm.dev).

**Análise**:
Embora o GitHub Pages seja excelente para hosting estático gratuito, ele não escala para múltiplos domínios em um único monorepo (`refarm.me`, `refarm.social`).

**Estratégia Proposta**:
1. **GitHub Pages**: Mantém o `refarm.dev` (via `apps/dev`). É o ponto de entrada principal e institucional.
2. **Cloudflare Pages / Others**: Usado para as outras distros (`refarm.me` em `refarm.me`, etc.).
    - Cloudflare se alinha bem com a visão de "Edge Connectivity" do Refarm.
    - Permite múltiplos sites apontando para diferentes filtros/pastas do mesmo monorepo.

**Conclusão**: Não precisamos escolher um único app para "ganhar" o GitHub Pages. Usamos o GitHub Pages para o `dev` e outras nuvens para expandir as distros.

## Reflexão 3: Evolução para Monorepos Separados

**Visão**: Eventualmente, distros como `me` e `social` podem migrar para seus próprios monorepos.

**Análise**:
Isso é saudável. O core do Refarm (Tractor + SDK) permanecerá como packages independentes que as distros consomem.
- **Fase 1 (Atual)**: Tudo em um monorepo para acelerar o desenvolvimento do "Solo Fértil".
- **Fase 2 (Evolução)**: Extração de distros maduras para repositórios especializados, permitindo plugins e governanças específicas.

## Mapeamento de Próximos Passos

1. Consolidar o `apps/dev` como o host tanto para o marketing/docs quanto para o Studio.
2. Configurar o deploy do `apps/me` em um provedor alternativo (Cloudflare suggested).
3. Garantir que os packages core (`@refarm.dev/*`) sejam agnósticos o suficiente para serem publicados e consumidos fora deste monorepo original.

---
*Documentado em 13 de Março de 2026 como parte das reflexões de Sistemas.*
