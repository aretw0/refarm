# Proposta: Centralização de Dependências no Monorepo Refarm

## Contexto
Atualmente, pacotes como o `@refarm.dev/toolbox` possuem versões de dependências (ex: Vitest v1.3.1) que divergem da raiz (v4.0.18), causando inconsistências, bugs de compatibilidade e lentidão no build.

## Objetivos
1.  **Consistência**: Garantir que todos os pacotes usem as mesmas versões de ferramentas de desenvolvimento (TS, Vitest, Lint).
2.  **Manutenibilidade**: Facilitar a atualização de ferramentas em todo o monorepo com uma única alteração.
3.  **Performance**: Reduzir o tamanho do `node_modules` e evitar duplicação de pacotes.

## Plano de Ação

### 1. Elevação para a Raiz
As seguintes dependências devem ser movidas para o `devDependencies` do `package.json` da raiz e removidas dos pacotes individuais:
- `typescript`
- `vitest`
- `@vitest/coverage-v8`
- `@vitest/ui`
- `turbo`
- `prettier` / `eslint` (conforme aplicável)

### 2. Uso de Workspaces
Ao usar `npm install` na raiz, o NPM 10+ gerencia o içamento (hoisting) dessas dependências. Os pacotes individuais podem continuar referenciando-as em seus scripts, mas sem precisar declará-las em seus próprios `package.json`.

### 3. Guardião da Saúde (`@refarm.dev/health`)
O pacote `health` será responsável por rodar um script de auditoria que:
- Verifica se algum pacote declarou uma versão de ferramenta que diverge da raiz.
- Valida a integridade das referências de workspace.
- Alerta sobre dependências não utilizadas.

---
*Proposta gerada por Manus AI em 22/03/2026.*
