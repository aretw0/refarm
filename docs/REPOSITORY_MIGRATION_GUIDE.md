# Guia de Migração: Repositório Pessoal → Organização

**Objetivo:** Migrar `github.com/aretw0/refarm` → `github.com/refarm-dev/refarm`

## ✅ Pré-requisitos

- [x] Organização `refarm-dev` criada no GitHub
- [x] URLs corrigidas nos package.json (apontam para refarm-dev)
- [ ] Transfer do repositório
- [ ] Configurar NPM automation token
- [ ] Configurar CI/CD para publish

## 📋 Checklist de Migração

### Fase 1: Transfer do Repositório

1. **No repositório `aretw0/refarm`:**
   - Settings → Danger Zone → Transfer ownership
   - New owner: `refarm-dev`
   - Repository name: `refarm` (manter o mesmo)
   - Type `aretw0/refarm` to confirm

2. **Verificar após transfer:**
   ```bash
   # Atualizar remote local
   git remote set-url origin https://github.com/refarm-dev/refarm.git
   
   # Confirmar
   git remote -v
   ```

3. **Testar clone fresco:**
   ```bash
   git clone https://github.com/refarm-dev/refarm.git
   cd refarm
   npm install
   npm run build --workspaces
   ```

### Fase 2: Configurar NPM Automation

1. **Criar NPM Automation Token:**
   - Login em https://www.npmjs.com/
   - Account → Access Tokens → Generate New Token
   - **Type:** Automation (permite CI/CD)
   - **Copiar o token** (aparece 1 vez só!)

2. **Adicionar Secret no GitHub:**
   - `github.com/refarm-dev/refarm` → Settings → Secrets and variables → Actions
   - New repository secret
   - **Name:** `NPM_TOKEN`
   - **Secret:** (colar token do npm)

### Fase 3: Namespace no npm

**Decisão:** Usar scoped package `@refarm-dev/*` (já configurado) OU criar org `@refarm`?

**Opção A: Manter `@refarm-dev` (atual)**
- ✅ Já funciona
- ✅ Namespace disponível
- ❌ Nome menos clean

**Opção B: Criar `@refarm` org no npm**
- ✅ Nome clean e profissional
- ❌ Requer pagar plano org ($7/mês)
- ❌ Namespace pode estar ocupado

**Verificar disponibilidade:**
```bash
npm view @refarm/storage-contract-v1  # Should be 404 if available
```

Se disponível E quiser investir:
1. https://www.npmjs.com/org/create
2. Organization name: `refarm`
3. Invite members da org GitHub
4. Atualizar todos os package.json: `@refarm-dev/*` → `@refarm/*`

**Recomendação:** Começar com `@refarm-dev`, migrar para `@refarm` quando tiver tração.

### Fase 4: CI/CD para Publish

Criar `.github/workflows/publish-packages.yml`:

```yaml
name: Publish Packages

on:
  push:
    tags:
      - '@refarm-dev/storage-contract-v1@*'
      - '@refarm-dev/sync-contract-v1@*'
      - '@refarm-dev/identity-contract-v1@*'
      - '@refarm-dev/plugin-manifest@*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # For provenance
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: 'https://registry.npmjs.org'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build all packages
        run: npm run build --workspaces
      
      - name: Extract package info from tag
        id: pkg
        run: |
          TAG="${{ github.ref_name }}"
          PKG_NAME=$(echo "$TAG" | sed 's/@\([^@]*\)$//')
          VERSION=$(echo "$TAG" | sed 's/.*@//')
          WORKSPACE=$(echo "$PKG_NAME" | sed 's/@refarm-dev\//packages\//' | sed 's/-contract-v/-contract-v/')
          
          echo "name=$PKG_NAME" >> $GITHUB_OUTPUT
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "workspace=$WORKSPACE" >> $GITHUB_OUTPUT
      
      - name: Verify package version matches tag
        working-directory: packages/${{ steps.pkg.outputs.workspace }}
        run: |
          PKG_VERSION=$(node -p "require('./package.json').version")
          if [ "$PKG_VERSION" != "${{ steps.pkg.outputs.version }}" ]; then
            echo "❌ Version mismatch: tag=${{ steps.pkg.outputs.version }}, package.json=$PKG_VERSION"
            exit 1
          fi
      
      - name: Run conformance tests
        run: npm run test:capabilities
      
      - name: Publish to npm
        working-directory: packages/${{ steps.pkg.outputs.workspace }}
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      
      - name: Create GitHub Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ github.ref_name }}
          release_name: ${{ steps.pkg.outputs.name }} v${{ steps.pkg.outputs.version }}
          body: |
            Published ${{ steps.pkg.outputs.name }}@${{ steps.pkg.outputs.version }} to npm.
            
            Install: `npm install ${{ steps.pkg.outputs.name }}@${{ steps.pkg.outputs.version }}`
          draft: false
          prerelease: ${{ contains(steps.pkg.outputs.version, '-') }}
```

### Fase 5: Workflow de Publicação

**Para publicar um pacote:**

```bash
# 1. Verificar estado
git status  # Should be clean
npm run test:capabilities  # Should pass

# 2. Bump version (se necessário)
cd packages/storage-contract-v1
npm version patch  # ou minor/major
cd ../..

# 3. Commit + tag
git add packages/storage-contract-v1/package.json
git commit -m "chore(storage-contract-v1): release v0.1.1"
git tag @refarm-dev/storage-contract-v1@0.1.1

# 4. Push tag (dispara CI)
git push origin @refarm-dev/storage-contract-v1@0.1.1

# 5. Acompanhar
# GitHub Actions → Publish Packages workflow
# Verá build, tests, publish, release creation
```

**Rollback se necessário:**
```bash
# Deprecate version no npm
npm deprecate @refarm-dev/storage-contract-v1@0.1.1 "Yanked - use 0.1.2+"

# Publish hotfix
npm version patch
npm publish
```

## 🔒 Segurança

1. **NPM Token:** Nunca commitar no git, só no GitHub Secrets
2. **Provenance:** `--provenance` flag garante assinatura verificável
3. **2FA:** Habilitar no npm account
4. **Branch protection:** Exigir PR + reviews antes de merge em main
5. **CODEOWNERS:** Definir quem pode aprovar mudanças em packages/

## 📊 Monitoramento

Após primeira publicação:

1. **npm package page:** https://www.npmjs.com/package/@refarm-dev/storage-contract-v1
2. **Download stats:** npm trends
3. **Security:** Snyk/Dependabot para vulnerabilidades
4. **Badge no README:**
   ```markdown
   [![npm version](https://img.shields.io/npm/v/@refarm-dev/storage-contract-v1)](https://www.npmjs.com/package/@refarm-dev/storage-contract-v1)
   ```

## ⚠️ Rollout Seguro

**Primeiro publish (0.1.0):**
- Marcar como `alpha` nos READMEs
- Avisar que breaking changes são esperados
- Pedir feedback em GitHub Discussions

**Antes de 1.0.0:**
- Dogfood interno (sync-crdt, identity-nostr)
- External alpha testers (2-3 plugins third-party)
- Stability period (2 semanas sem breaking changes)
- Documentation review
- Performance benchmarks

**1.0.0 Release:**
- Commitment de semver estrito
- CHANGELOG.md obrigatório
- Deprecation policy (manter versão anterior por 6 meses)

## 🎯 Timeline Sugerido

- **Semana 1:** Transfer repo + configurar CI/CD
- **Semana 2:** Dogfood interno + documentação
- **Semana 3:** Alpha release para early adopters
- **Mês 2-3:** Iteração baseada em feedback
- **Mês 4:** 1.0.0 release (stable)

---

**Status Atual:**
- ✅ URLs corrigidas para refarm-dev
- ⏳ Aguardando transfer do repositório
- ⏳ Aguardando configuração NPM token
- ⏳ Aguardando primeiro publish via CI
