# GitHub Actions Workflows

## Overview

Este diretório contém workflows automatizados para CI/CD do projeto Refarm.

## Workflows Ativos

### 1. `test.yml` — Continuous Integration

**Trigger:** Push, Pull Request
**Objetivo:** Validar qualidade do código

**Steps:**
- Type checking (TypeScript)
- Lint (ESLint)
- Unit tests + conformance tests
- E2E tests (validations)
- Build artefacts

### 2. `publish-packages.yml` — Package Publishing

**Trigger:** Push de git tags no formato `@refarm.dev/<package>@<version>`
**Objetivo:** Publicar pacotes no npm de forma segura e automatizada

**Examples:**
```bash
git tag @refarm.dev/storage-contract-v1@0.1.0
git push origin @refarm.dev/storage-contract-v1@0.1.0
```

**Steps:**
1. Validações (type-check, tests, dry-run)
2. Publish para npm com provenance
3. Criação de GitHub Release
4. Verificação pós-publicação

**Requirements:**
- `NPM_TOKEN` configurado em Secrets (automation token)
- Version no `package.json` deve corresponder ao tag
- Todos os testes devem passar

## How to Publish a Package

**Opção 1: Helper Script (Recomendado)**

```bash
# Bump patch version (0.1.0 → 0.1.1)
npm run release storage-contract-v1 patch

# Bump minor version (0.1.0 → 0.2.0)
npm run release sync-contract-v1 minor

# Set specific version
npm run release identity-contract-v1 0.3.0
```

O script automaticamente:
- ✅ Valida git status clean
- ✅ Bumps version no package.json
- ✅ Roda type-check + tests + conformance
- ✅ Cria commit + tag
- ℹ️ Informa comando para push do tag

**Opção 2: Manual**

```bash
# 1. Navigate to package
cd packages/storage-contract-v1

# 2. Bump version
npm version patch  # ou minor/major

# 3. Build + test
npm run build
npm run test:unit

# 4. Commit + tag (from root)
cd ../..
git add packages/storage-contract-v1/package.json
git commit -m "chore(storage-contract-v1): release v0.1.1"
git tag @refarm.dev/storage-contract-v1@0.1.1

# 5. Push tag (triggers CI)
git push origin @refarm.dev/storage-contract-v1@0.1.1
```

## Monitoring Releases

1. **GitHub Actions:** https://github.com/refarm-dev/refarm/actions
2. **npm Package:** https://www.npmjs.com/package/@refarm.dev/storage-contract-v1
3. **GitHub Releases:** https://github.com/refarm-dev/refarm/releases

## Rollback a Release

Se uma versão foi publicada com problemas:

```bash
# 1. Deprecate no npm (não remove, apenas avisa)
npm deprecate @refarm.dev/storage-contract-v1@0.1.1 "Broken release - use 0.1.2+"

# 2. Publish hotfix
npm run release storage-contract-v1 patch  # → 0.1.2
git push origin @refarm.dev/storage-contract-v1@0.1.2
```

⚠️ **NUNCA use `npm unpublish`** — quebra dependências de consumidores.

## Secrets Required

Configurar em: https://github.com/refarm-dev/refarm/settings/secrets/actions

| Secret | Description | How to Get |
|--------|-------------|------------|
| `NPM_TOKEN` | npm automation token | https://www.npmjs.com/settings/[user]/tokens → Generate (Automation) |
| `GITHUB_TOKEN` | Provided automatically | - |

## Security Best Practices

1. ✅ Use **Automation tokens** (não Classic tokens)
2. ✅ Enable **2FA** no npm account
3. ✅ Publish com **provenance** (`--provenance` flag)
4. ✅ Review changes antes do push do tag
5. ✅ Monitor downloads suspeitos (typosquatting attacks)

## Troubleshooting

### "Version mismatch" Error

```
❌ Version mismatch: tag=0.1.1, package.json=0.1.0
```

**Fix:**
```bash
cd packages/storage-contract-v1
npm version 0.1.1 --no-git-tag-version
git add package.json
git commit --amend --no-edit
git push -f origin <branch>
```

### "NPM_TOKEN not set"

```
❌ This command requires you to be logged in
```

**Fix:** Configurar `NPM_TOKEN` no GitHub Secrets (ver acima).

### "Publish failed - package already exists"

Você tentou publicar uma versão que já existe no npm.

**Fix:** Bump para próxima versão:
```bash
npm run release <package> patch
```

## References

- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub Actions](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/)
