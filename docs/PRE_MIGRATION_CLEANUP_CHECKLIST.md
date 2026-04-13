# Pre-Migration Cleanup Checklist

> **Purpose**: Tudo que deve estar limpo e verificado **antes** de transferir o repositório
> para a organização `refarm-dev`. Execute este checklist do topo para baixo; nenhuma seção
> depende de outra, mas todas devem estar verdes antes da transferência.
>
> **When to use**: Com v0.1.0 gates passados. Ver [docs/v0.1.0-release-gate.md](v0.1.0-release-gate.md).
> **After transfer**: Executar [docs/POST_TRANSFER_CHECKLIST.md](POST_TRANSFER_CHECKLIST.md).

---

## 1. Documentation

- [ ] `docs/INDEX.md` está atualizado (data, sem ghost links, todos os docs registrados)
- [ ] Nenhum link em `docs/INDEX.md` aponta para um arquivo que não existe
  ```bash
  # Verificar ghost links: cada entry no INDEX deve existir no filesystem
  grep -o '](.*\.md)' docs/INDEX.md | tr -d ')](' | while read f; do
    [ -f "docs/$f" ] || [ -f "$f" ] || echo "MISSING: $f"
  done
  ```
- [ ] CONTRIBUTING.md usa nomenclatura atual (Distros + Blocks, não "Kernel e Studio")
- [ ] `specs/ADRs/README.md` indexa todos os ADRs existentes (incluindo 047, 048, 049)
- [ ] Nenhuma entrada no `docs/decision-log.md` referencia um ADR com número errado
- [ ] `apps/me/ROADMAP.md` e `apps/dev/ROADMAP.md` existem e estão atualizados
- [ ] `docs/distro-evolution-model.md` existe e referencia os ADRs corretos
- [ ] `docs/schema-migration-strategy.md` existe e documenta o contrato `refarm migrate`

---

## 2. Packages — Distribution Readiness

Ver [packages/DISTRIBUTION_STATUS.md](../packages/DISTRIBUTION_STATUS.md) para status atualizado.

- [ ] Cada package publicável tem `README.md` com exemplos de uso
- [ ] Cada package publicável tem `CHANGELOG.md` (gerado via Changesets)
- [ ] `"publishConfig": { "access": "public" }` está no `package.json` de todos os packages publicáveis
- [ ] Campo `"repository"` em cada `package.json` aponta para o owner atual (pós-transfer: `github.com/refarm-dev/refarm`)
- [ ] Packages com `"private": true` estão corretos (apps/, tooling interno)
- [ ] Rodar `node scripts/verify-packages.mjs` sem erros:
  ```bash
  node scripts/verify-packages.mjs
  ```

### 4 Contract Packages — critérios mínimos
- [ ] `@refarm.dev/storage-contract-v1` — conformance suite passa
- [ ] `@refarm.dev/identity-contract-v1` — conformance suite passa
- [ ] `@refarm.dev/sync-contract-v1` — conformance suite passa
- [ ] `@refarm.dev/plugin-manifest` — schema validation passa

---

## 3. npm Scope

> **Decisão alvo**: GitHub org = `refarm-dev`, npm scope = `@refarm.dev`. Ver [ADR-019](../specs/ADRs/ADR-019-npm-scope-and-namespace-strategy.md).
> **Operação atual**: release pode ocorrer no scope/profile ativo (ex.: `@aretw0`) até a migração.

- [ ] Conta npm com acesso ao scope ativo está configurada
- [ ] `NPM_TOKEN` do tipo "Automation" criado com permissão Read + Publish no scope ativo
- [ ] Token adicionado como secret `NPM_TOKEN` no GitHub (no novo org, pós-transfer)
- [ ] `.npmrc` na raiz confirma `<scope-ativo>:registry=https://registry.npmjs.org/`

---

## 4. GitHub Configuration

A configurar **na nova organização** `refarm-dev` imediatamente após o transfer:

- [ ] Branch protection em `main`: require PR reviews, require CI pass, no force push
- [ ] Branch protection em `develop`: require CI pass
- [ ] Actions secrets migrados: `NPM_TOKEN`, `CODECOV_TOKEN` (se usar), qualquer deploy key
- [ ] Variables de release configuradas: `RELEASE_AUTOMATION=true` e opcional `RELEASE_OWNER=<owner>`
- [ ] GitHub Pages configurado para `apps/dev` (se aplicável)
- [ ] Repository visibility confirmada (public, para que CI/CD e publicação funcionem)
- [ ] `.github/workflows/` revisados: nenhuma referência hardcoded ao repo antigo `refarm/refarm`
  ```bash
  grep -r "refarm/refarm" .github/
  ```

---

## 5. CI/CD — Verificação Final

- [ ] `npm run build` sem erros (todos os packages)
- [ ] `npm run test` passando (unit + integration)
- [ ] `npm run lint` sem erros em `main` ou `develop`
- [ ] `npm run type-check` sem erros
- [ ] `npm run diagrams:fix` atualiza SVGs sem erro
- [ ] `node scripts/reso.mjs status` mostra estado esperado (dist em produção, src em dev local)

---

## 6. Scripts de Migração

Scripts em `scripts/` que podem ser usados para automatizar ou verificar partes da migração:

| Script | Propósito |
|--------|-----------|
| `node scripts/verify-packages.mjs` | Valida estrutura e campos dos packages |
| `node scripts/reso.mjs status` | Mostra estado de resolução de entry points |
| `node scripts/audit-readme-quality.mjs` | Audita qualidade dos READMEs |
| `node scripts/check-deps.mjs` | Verifica dependências entre packages |
| `node scripts/migration-health-check.mjs` | Health check pós-migração (se existir) |

---

## 7. Dogfooding Note

> Esta migração é, intencionalmente, um **teste real** do que construímos.
>
> O processo de transferência + publicação testa:
> - `installPlugin()` com SHA-256 (pacotes publicados no npm são os plugins do ecossistema)
> - `refarm migrate` CLI (os próprios packages de storage evoluem seu schema)
> - Distro boot de `apps/me` (a configuração pós-transfer é idêntica ao que um usuário final fará)
>
> Se algo neste checklist for difícil ou quebrar, é um sinal de que o produto tem uma fricção
> que o usuário final também sentirá. Corrigir aqui é corrigir para o produto.

---

> **Próximo passo depois deste checklist**: [docs/REPOSITORY_MIGRATION_GUIDE.md](REPOSITORY_MIGRATION_GUIDE.md)
