# Repository Migration Guide — `refarm` → `refarm-dev`

> **Purpose**: Playbook completo para transferir o repositório e publicar os packages pela
> primeira vez na organização `refarm-dev`.
>
> **Pre-requisite**: [docs/PRE_MIGRATION_CLEANUP_CHECKLIST.md](PRE_MIGRATION_CLEANUP_CHECKLIST.md) completo.
> **After transfer**: [docs/POST_TRANSFER_CHECKLIST.md](POST_TRANSFER_CHECKLIST.md) para ações imediatas.
>
> Este documento **será deletado ou arquivado** após a migração completar. É um guia operacional,
> não documentação permanente.

---

## Pre-Conditions (before touching GitHub)

Todos os gates devem estar verdes:

- [ ] v0.1.0 Gate 1 — Offline-first primitives: passed
- [ ] v0.1.0 Gate 2 — Schema migration tooling: passed
- [ ] v0.1.0 Gate 3a — Technical primitives (BrowserSyncClient + Loro + installPlugin): passed
- [ ] v0.1.0 Gate 3b — Reference Distro (`apps/me` consolidated boot): passed
- [ ] CI em `main` 100% verde
- [ ] Pre-Migration Cleanup Checklist: completo

Ver [docs/v0.1.0-release-gate.md](v0.1.0-release-gate.md) para detalhes de cada gate.

---

## Step 1 — Create the `refarm-dev` Organization on GitHub

Se a organização ainda não existe:

1. Acesse [github.com/organizations/new](https://github.com/organizations/new)
2. Nome: `refarm-dev`
3. Plan: Free (pode ser upgradeado depois)
4. Billing: configurar após criar

---

## Step 2 — Transfer the Repository

**No repositório atual** (`github.com/YOUR_USERNAME/refarm` ou `github.com/refarm/refarm`):

1. Vá para **Settings → General → Danger Zone → Transfer ownership**
2. Novo owner: `refarm-dev`
3. Confirme digitando o nome do repositório
4. O repositório passa a ser `github.com/refarm-dev/refarm`

> GitHub automaticamente configura redirects do URL antigo para o novo. Os clones existentes
> continuarão funcionando temporariamente, mas atualize os remotes o quanto antes.

### Atualizar remote local

```bash
git remote set-url origin https://github.com/refarm-dev/refarm.git
git remote -v  # confirmar
```

---

## Step 3 — Post-Transfer: Update package.json Fields

Em cada `package.json` de package publicável, atualizar o campo `repository`:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/refarm-dev/refarm.git",
    "directory": "packages/PACKAGE_NAME"
  }
}
```

Script para verificar quais ainda usam o URL antigo:

```bash
grep -r '"url".*github.com' packages/*/package.json | grep -v "refarm-dev"
```

---

## Step 4 — Configure GitHub Actions Secrets

No novo org (`github.com/refarm-dev`), configurar os secrets necessários:

| Secret | Onde obter | Para quê |
|--------|-----------|----------|
| `NPM_TOKEN` | npmjs.com → Account → Access Tokens → Automation | Publicar packages via CI |
| `CODECOV_TOKEN` | codecov.io (se usar) | Upload de coverage reports |

**Settings → Secrets and variables → Actions → New repository secret**

Variables recomendadas (repository variables):

| Variable | Valor sugerido | Para quê |
|---|---|---|
| `RELEASE_AUTOMATION` | `true` | Habilita jobs de publicação |
| `RELEASE_OWNER` | `refarm-dev` | Lock opcional por owner (evita publish em forks) |

---

## Step 5 — Configure Branch Protection

Em **Settings → Branches**:

### `main`
- [x] Require a pull request before merging
- [x] Require status checks to pass (selecionar: `test`, `quality-gates`, `type-check`)
- [x] Require branches to be up to date before merging
- [x] Do not allow bypassing the above settings
- [x] Restrict force pushes

### `develop`
- [x] Require status checks to pass (selecionar: `test`)
- [x] Do not allow force pushes

---

## Step 6 — First npm Publish

Após CI estar verde e secrets configurados:

```bash
# Garantir que está em main, limpo, com a versão correta
git checkout main
git pull origin main

# Rodar o release script (usa Changesets)
npm run release

# Verificar publicação no npm
npm view @refarm.dev/storage-contract-v1
npm view @refarm.dev/identity-contract-v1
npm view @refarm.dev/sync-contract-v1
npm view @refarm.dev/plugin-manifest
```

> Se o profile ativo de scope estiver em namespace pessoal, substitua os exemplos acima pelo scope correspondente (ex.: `@aretw0/...`).

Se a publicação automática via CI não funcionar, publicar manualmente:

```bash
# Autenticar no npm
npm login --scope=@refarm.dev

# Publicar um package específico
cd packages/storage-contract-v1
npm publish --access public
```

---

## Step 7 — Verify the Migration

```bash
# 1. Clone fresh no novo URL
git clone https://github.com/refarm-dev/refarm.git /tmp/refarm-verify
cd /tmp/refarm-verify

# 2. Build completo
npm install
npm run build

# 3. Testes
npm run test

# 4. Verificar packages publicados são instaláveis
mkdir /tmp/refarm-consumer-test
cd /tmp/refarm-consumer-test
npm init -y
npm install @refarm.dev/storage-contract-v1
node -e "const { StorageContract } = require('@refarm.dev/storage-contract-v1'); console.log('✅ Package installs correctly')"
```

---

## Step 8 — Update Documentation Links

Após confirmar que tudo está funcionando:

- [ ] `README.md` — atualizar qualquer link ou badge que referencie o repo antigo
- [ ] `packages/DISTRIBUTION_STATUS.md` — atualizar status para "PUBLISHED"
- [ ] `.github/workflows/` — verificar se algum workflow referencia o repo por nome hardcoded
- [ ] Arquivar ou deletar este documento (`docs/REPOSITORY_MIGRATION_GUIDE.md`)

---

## Dogfooding Note

> A migração em si é o primeiro teste real do ecossistema Refarm:
>
> - **installPlugin()** será chamado por usuários instalando packages do npm — os mesmos
>   mecanismos de SHA-256 e OPFS que testamos no Gate 3b.
> - **refarm migrate** será executado quando usuários atualizarem de v0.1.0 para versões futuras.
> - **Boot de apps/me** replicará exatamente o flow que qualquer usuário final terá ao
>   abrir `refarm.me` pela primeira vez.
>
> Se algo neste guia for difícil, é um bug de produto. Documente e crie um issue.

---

## References

- [docs/v0.1.0-release-gate.md](v0.1.0-release-gate.md) — Gate criteria
- [docs/PRE_MIGRATION_CLEANUP_CHECKLIST.md](PRE_MIGRATION_CLEANUP_CHECKLIST.md) — Pre-conditions
- [docs/POST_TRANSFER_CHECKLIST.md](POST_TRANSFER_CHECKLIST.md) — Immediate post-transfer actions
- [specs/ADRs/ADR-019-npm-scope-and-namespace-strategy.md](../specs/ADRs/ADR-019-npm-scope-and-namespace-strategy.md) — npm scope decision
- [packages/DISTRIBUTION_STATUS.md](../packages/DISTRIBUTION_STATUS.md) — Package readiness
- [roadmaps/MAIN.md](../roadmaps/MAIN.md) — v0.1.0 milestone context
