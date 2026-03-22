# Proposta: Elevação do `reso` para `@refarm.dev/toolbox`

## Contexto
O script `reso.mjs` é vital para a experiência de desenvolvimento no monorepo Refarm, permitindo alternar entre resolução local (`src`) e publicada (`dist`). Atualmente, ele reside em `scripts/`, o que dificulta seu teste, versionamento e reuso.

## Objetivos
1.  **Ownership**: Mover a lógica para `@refarm.dev/toolbox`.
2.  **Testabilidade**: Adicionar suíte de testes unitários para garantir que a resolução de `exports`, `main` e `types` nunca regrida.
3.  **Guardrails**: Implementar verificações de segurança para evitar corrupção de `package.json`.
4.  **CLI**: Expor o `reso` como um comando da CLI do toolbox.

## Plano de Implementação

### 1. Estrutura no Toolbox
- `packages/toolbox/src/reso/`:
    - `index.ts`: API programática.
    - `cli.ts`: Interface de linha de comando.
    - `logic.ts`: Lógica de transformação de caminhos (refatorada do `reso.mjs`).
    - `__tests__/reso.test.ts`: Testes unitários com mocks de sistema de arquivos.

### 2. Melhorias na Lógica
- **Suporte a Sub-exports**: Lidar corretamente com caminhos como `./test/test-utils`.
- **Validação de Esquema**: Garantir que o `package.json` resultante ainda seja um JSON válido.
- **Dry Run**: Adicionar flag `--dry-run` para visualizar mudanças antes de aplicá-las.
- **Backup**: Criar backups automáticos (`package.json.bak`) antes de modificações em massa.

### 3. Workflow de Migração
1.  Implementar a lógica no `toolbox`.
2.  Adicionar testes cobrindo os cenários atuais (`tractor-ts`, `homestead`, `barn`).
3.  Substituir o `scripts/reso.mjs` por um wrapper que chama o `toolbox`.
4.  Validar em ambiente real (Devcontainer).

---
*Proposta gerada por Manus AI em 21/03/2026.*
