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

## Reflexão 4: Evolução para SSR e Hibridismo

**Pergunta**: Se o `dev` evoluir para SSR, ele ainda pode aproveitar o GitHub Pages para a parte estática e outras nuvens para a parte dinâmica?

**Análise**:
Sim, e isso toca no coração do princípio de **Sovereignty** do Refarm.

1. **Hibridismo Nativo do Astro**: O Astro permite configurar o `output: 'hybrid'`. Isso significa que podemos marcar páginas de documentação e marketing como `prerender = true` (Estáticas) e deixar as funcionalidades de backend/edge como dinâmicas.
2. **Distribuição de Assets**: No limite, você pode ter o "Core" do app (o Bootloader estático) servido pelo GitHub Pages e as requisições de dados/processamento sendo feitas para um **Edge Worker** (Cloudflare) que roda 24h.
3. **Sovereign Bootloader (ADR-036)**: É crucial lembrar que no Refarm, o SSR **nunca** deve ser o responsável por renderizar a UI inicial. A UI deve ser sempre soberana no browser do usuário. O SSR/Edge entra como uma "Camada de Conveniência" ou "Mailbox" para processamento assíncrono.
4. **Multi-Origin**: Se o app precisar de SSR para funcionalidades complexas (ex: logs, relays Nostr, processamento pesado), ele pode ser publicado no Cloudflare como o host principal (que lida com ambos), enquanto o GitHub Pages mantém uma versão "Ultra-Resiliente/Estática" que serve como fallback ou espelho oficial da documentação.

**Conclusão**: O hibridismo é o caminho. O GitHub Pages serve a "Paz de Espírito" de ter o código e o bootloader sempre disponíveis, enquanto o SSR em outras nuvens provê a "Potência" necessária para as distros evoluírem.

## Reflexão 5: Estratégia PWA (Day 1)

**Pergunta**: Teremos vários PWAs, um para cada domínio? Tudo será PWA desde o Dia 1?

**Análise**:
A natureza **Offline-First** (ADR-002) do Refarm exige que a experiência do app seja fundamentada em tecnologias de Service Workers para garantir que o sistema funcione sem rede.

1. **Um PWA por Domínio**: Sim. Cada distro (`dev`, `me`, `social`) terá seu próprio `manifest.json` e Service Worker.
    - Isso permite que o usuário instale o "Refarm Studio" no desktop e o "Refarm.me" no celular como apps independentes.
    - Evita confusão de escopo de cache e permissões entre as diferentes personalidades do sistema.
2. **PWA Day 1 (Hibridismo de Entrypoint)**:
    - A **Landing Page/Docs** não precisa ser necessariamente instalável para todos, mas o **Núcleo do App** (o `/studio` no `dev`, ou o `/hub` no `me`) deve ser PWA desde o primeiro deploy.
    - Isso garante que a promessa de soberania de dados (SQLite/OPFS) seja acompanhada pela soberania de execução (Service Worker caching).
3. **Partes não-PWA**: A documentação pública e conteúdos de marketing podem se comportar como sites tradicionais para SEO e descoberta, enquanto o "Sovereign Bootloader" assume o papel de PWA assim que o usuário entra no fluxo de uso do sistema.

**Conclusão**: O PWA não é um "feature extra", é a forma como o Sovereign Bootloader é entregue. Teremos múltiplos PWAs isolados por domínio para garantir clareza e independência.

## Mapeamento de Próximos Passos

1. Consolidar o `apps/dev` como o host tanto para o marketing/docs quanto para o Studio.
2. Configurar o deploy do `apps/me` em um provedor alternativo (Cloudflare suggested).
3. Garantir que os packages core (`@refarm.dev/*`) sejam agnósticos o suficiente para serem publicados e consumidos fora deste monorepo original.

---
*Documentado em 13 de Março de 2026 como parte das reflexões de Sistemas.*
