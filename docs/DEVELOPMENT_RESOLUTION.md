# Resolução de Módulos no Refarm: `src` vs `dist`

Este documento descreve a estratégia de resolução de módulos no monorepo Refarm, o papel da ferramenta `reso` (integrada ao `@refarm.dev/toolbox`) e como gerenciar a alternância entre o consumo de código-fonte (`src`) e artefatos compilados (`dist`).

---

## 1. O Mecanismo de Resolução (`reso`)

A ferramenta `reso` automatiza a modificação dos campos `main`, `types` e `exports` nos arquivos `package.json` de todos os pacotes do monorepo. Isso permite que o ecossistema TypeScript/Node.js enxergue as dependências internas de duas formas:

*   **Modo `src` (Local)**: Aponta para os arquivos `.ts` ou `.mts` dentro da pasta `src/`. Ideal para desenvolvimento ativo com feedback instantâneo e navegação de código precisa no VS Code.
*   **Modo `dist` (Publicado)**: Aponta para os arquivos compilados `.js` ou `.mjs` dentro da pasta `dist/`. Essencial para validar o build final, rodar testes de integração fiéis e preparar para publicação.

### Comandos Disponíveis:

| Comando | Ação | Uso Recomendado |
|---|---|---|
| `node scripts/reso.mjs src` | Alterna todos os pacotes compatíveis para `src/`. | Fluxo de desenvolvimento diário. |
| `node scripts/reso.mjs dist` | Alterna todos os pacotes para `dist/`. | Pré-commit, CI/CD e validação de build. |
| `node scripts/reso.mjs status` | Exibe o estado atual de cada pacote. | Diagnóstico de ambiente. |

---

## 2. Exceções e Comportamentos Específicos

Nem todos os pacotes no monorepo seguem o ciclo de vida padrão de `src` para `dist`. Algumas exceções são fundamentais para a estabilidade da infraestrutura:

### Pacotes que Não Chaveiam (Sempre `PUBLISHED`)

Alguns pacotes são marcados permanentemente como `PUBLISHED (dist)` pela lógica do `reso` por motivos técnicos:

*   **`@refarm.dev/tsconfig`**: É um pacote de configuração pura. Não possui lógica `src` para ser chaveada; ele fornece a base para todos os outros `tsconfig.json`.
*   **`@refarm.dev/heartwood`**: Um núcleo criptográfico baseado em **WASM**. Sua interface JS é gerada no diretório `pkg/`. Como o `reso` identifica `pkg/` como um artefato de saída (similar ao `dist/`), ele permanece em modo publicado para garantir que o host consuma o WASM transpilado.
*   **`@refarm.dev/homestead`**: Atualmente focado em definições e contratos que servem de base estável para o `tractor`.
*   **`@refarm.dev/storage-memory`**: Frequentemente mantido em `dist` para servir como uma implementação de referência estável durante testes de outros plugins.

### Apps (Distros)

Os pacotes no diretório `apps/` (como `dev`, `me`, `farmhand`) são considerados **"bootloaders"**. Eles não são consumidos como bibliotecas por outros pacotes, portanto, o `reso` não altera seus `package.json`. Eles sempre operam em modo `LOCAL (src)` internamente.

---

## 3. Padronização de Estrutura

Para que um pacote seja compatível com o chaveamento automático do `reso`, ele deve seguir a estrutura:
1.  Código-fonte em `src/`.
2.  `package.json` com campos `main`, `types` e `exports` apontando para caminhos relativos.
3.  `tsconfig.json` configurado com `rootDir: "src"` e `outDir: "dist"`.

> **Nota sobre o pacote `config`**: Este pacote foi recentemente refatorado para seguir este padrão, movendo seus arquivos `.mjs` para `src/` e renomeando-os para `.ts`, garantindo que ele agora participe plenamente do ciclo de resolução.

---

## 4. Diagnóstico e Resolução de Problemas (Troubleshooting)

### 4.1 Erros de Build no Astro/Vite (Resolução de Aliases)

Em monorepos complexos, o Astro/Vite pode falhar ao resolver imports de pacotes internos (ex: `@refarm.dev/homestead/ui`) mesmo com o `tsconfig.json` correto. 

**Causa**: O Vite trata pacotes locais como externos por padrão, tentando buscar arquivos no `dist/` (que podem não existir no modo `src`).

**Solução (Implementada no `@refarm.dev/config/astro`)**:
1.  **`noExternal`**: Force a inclusão do pacote no bundle do Vite para que os fontes (`.ts`, `.astro`) sejam processados em tempo real.
2.  **Aliases Manuais**: Em casos de sub-rotas complexas (ex: `/ui`, `/sdk`), defina aliases explícitos no `vite.resolve.alias` apontando para o arquivo `index.ts` na `src/`.
3.  **Extensões**: Certifique-se de que `.astro` está na lista de `resolve.extensions` do Vite se você exporta componentes Astro através de arquivos TypeScript.

### 4.2 Erros de `rootDir` no TypeScript

**Erro**: `File '...' is not under 'rootDir' '...'. 'rootDir' is expected to contain all source files.`

**Causa**: Arquivos de configuração (como `vitest.config.ts`) ou artefatos de build antigos na raiz do pacote sendo incluídos acidentalmente no `tsconfig.build.json`.

**Solução**:
1.  Garanta que o `tsconfig.build.json` tenha um `include` restrito à pasta `src/`.
2.  Exclua explicitamente arquivos de configuração da raiz no campo `exclude`.
3.  Limpe artefatos residuais (`.js`, `.d.ts`, `.map`) que possam ter sido gerados na raiz por builds mal configurados anteriormente.

### 4.3 Gestão de Vulnerabilidades (npm audit)

Em monorepos, o `npm audit fix` pode não ser suficiente para dependências profundas.

**Solução**: Use o campo `overrides` no `package.json` da raiz para forçar versões seguras de bibliotecas problemáticas (ex: `flatted` para corrigir Prototype Pollution) em toda a árvore de dependências.

### 4.4 Erros de Teste (Vitest 4 & WASM)

Se os testes falharem com `Segmentation fault` ou erros de `generateKeypair is not a function`:

1.  **Isolamento de Processo**: O Vitest 4 com WASM (Heartwood) exige isolamento de memória estável. Use `pool: 'forks'` com `singleFork: true` no `vitest.config.ts`.
2.  **Vazamento de Mocks**: Um `vi.mock` global em qualquer arquivo de teste pode sequestrar o módulo para o processo inteiro. Use mocks completos (incluindo `default: mock`) ou prefira `vi.doMock` dentro de cada teste para evitar poluição entre pacotes.
3.  **Carga Dinâmica (Lazy Loading)**: Módulos criptográficos (como Heartwood) devem ser carregados via `await import()` dentro dos métodos que os utilizam, e não no topo do arquivo. Isso evita que o motor WASM seja instanciado prematuramente durante a importação de suítes de teste que não o utilizam.
4.  **Resolução de Caminhos WASM**: O loader do Heartwood (`pkg/heartwood.js`) foi corrigido para usar `fileURLToPath` em ambiente Node.js, garantindo que arquivos locais sejam lidos via `fs.readFile` em vez de `fetch`, evitando erros de `ERR_INVALID_URL_SCHEME`.

---

## 5. Lições Aprendidas na Estabilização (Março 2026)

Durante a grande faxina de estabilização, consolidamos que:
*   **Headless-First exige Resolução Robusta**: Plugins que exportam UI precisam de uma infraestrutura de config que entenda a dualidade `src/dist`.
*   **Menos é Mais**: Evite múltiplos arquivos `vitest.config.*` na raiz dos pacotes; mantenha apenas o `.ts` canônico.
*   **Turbo é Sensível**: Se um pacote falha, o cache do Turbo pode esconder erros subsequentes. Sempre limpe ou use `--force` ao debugar infraestrutura.

---

## Referências

[1] [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
[2] [Refarm Architecture - Stratification](./STRATIFICATION.md)
[3] [TypeScript Infrastructure in Refarm](./TYPESCRIPT_INFRASTRUCTURE.md)
