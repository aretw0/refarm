# Sanidade de Ambiente (Checkout por SO)

## Problema que vimos
Em alguns momentos, o workspace de um container começou a receber symlinks/artefatos de outro checkout em SO diferente (ex.: caminhos `/mnt/host/...`), além de permissões misturadas (`root` vs `vscode`). Resultado: `pnpm` falhava com `EACCES` e a base do ambiente ficava instável.

Para evitar isso, precisamos garantir que **cada ambiente de execução use seu próprio checkout**.

---

## Regra operacional (objetivo)
- **Checkout Linux/container:** `.../refarm` dentro do container (ex.: `/workspaces/refarm`).
- **Checkout Windows/host:** um clone separado, local ao seu desktop (ex.: `C:\...\refarm`).
- Não misturar dependências (`node_modules`, symlinks, caches de lock/instalador) entre SOs.
- Use o checkout “outro SO” prioritariamente para **leitura**. Se precisar editar, faça no agente do projeto daquele checkout.

---

## Script novo: `scripts/env-safety-check.sh`

Esse script valida rapidamente:
- localização do checkout (evita path suspeito tipo `/mnt/*` em container),
- donos de `node_modules` fora do usuário atual,
- symlinks quebrados em `node_modules`,
- symlinks com alvo cruzando SO (`/mnt/host/*`, padrões Windows/drive).

### Como rodar

```bash
# validação normal (modo estrito, falha no erro)
bash scripts/env-safety-check.sh

# apenas diagnóstico não bloqueante (ideal em post-start)
bash scripts/env-safety-check.sh --warn

# com tentativa de reparo de ownership em node_modules (sem corrigir targets quebrados)
bash scripts/env-safety-check.sh --repair
```

Também pode usar pelo NPM script:

```bash
pnpm run env:safety -- --warn
pnpm run env:safety -- --repair
```

---

## Fluxo recomendado

Observação de integração no pipeline:
- O script também é invocado no `./.github/actions/setup/action.yml` (pré-`pnpm install`) em runners Linux com o modo `--warn`, para registrar problemas de ambiente antes da instalação de dependências.
- Para checagem estrita em CI, é possível invocar o setup com `env-safety-mode: strict` (usado em `platform-compat`).


1. Se receber `EACCES`/`symlink` estranho novamente:
   - rode `bash scripts/env-safety-check.sh --strict`,
   - confirme se há paths fora do `/workspaces` no container,
   - rode `bash scripts/env-safety-check.sh --repair` se houver dono `root` em `node_modules`,
   - se persistir, remova o checkout contaminado e faça `pnpm install` novamente no checkout correto do SO.

2. Antes de `pnpm install` pesado:
   - rode `bash scripts/env-safety-check.sh --warn`.

---

## Observação
Esse mecanismo não “constrói” um isolamento sozinho; ele **previne e denuncia** o primeiro sinal de contaminação para manter os fluxos de edição por SO separados e estáveis.