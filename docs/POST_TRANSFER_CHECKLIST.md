# Post-Transfer Checklist

Este documento contém as ações **obrigatórias** que devem ser executadas **imediatamente** após a transferência do repositório `aretw0/refarm` → `refarm-dev/refarm`.

---

## 🚨 Ações Imediatas (0-5 minutos)

### 1. Criar organização npm @refarm

```bash
# Via web: https://www.npmjs.com/org/create
# Nome da organização: refarm
# Scope será: @refarm
```

**Por que @refarm e não @refarm-dev?**
- GitHub org: `refarm-dev` (namespace técnico)
- npm scope: `@refarm` (namespace de marca)
- Domain: `refarm.dev` (marketing/docs)

### 2. Gerar NPM_TOKEN com permissão de publicação

```bash
# Via web: https://www.npmjs.com/settings/YOUR_USERNAME/tokens
# Token type: Automation (para CI/CD)
# Permissões: Read and Publish
# Scope: @refarm (a organização criada)
```

**Anotar o token gerado** (só aparece uma vez!)

### 3. Configurar Secrets e Variables no GitHub

**Settings → Secrets and variables → Actions**

#### Secrets (sensíveis):
```bash
# Nome: NPM_TOKEN
# Valor: [token gerado no passo 2]
# Scope: Repository secrets
```

#### Variables (não-sensíveis):
```bash
# Nome: RELEASE_AUTOMATION
# Valor: true
# Scope: Repository variables
```

**⚠️ CRITICAL**: Os workflows só executarão publicações quando:
- `github.repository_owner == 'refarm-dev'` (automático após transfer)
- `vars.RELEASE_AUTOMATION == 'true'` (configurado manualmente)

---

## 🚀 Primeira Release (5-15 minutos)

### 4. Validar workflows estão funcionando

O transfer do repositório deve ter acionado o workflow de testes automaticamente. Verificar:

```bash
# Via web: https://github.com/refarm-dev/refarm/actions
# Workflow: CI / Test → deve estar verde ✅
```

Se houver falhas, investigar **antes** de prosseguir com releases.

### 5. Triggerar o workflow de release

Há **duas estratégias** para a primeira release:

#### Estratégia A: Via Changesets (RECOMENDADA)

```bash
# Local:
git pull origin main

# O changeset já existe em .changeset/initial-contracts-release.md
# Criar um commit vazio para trigger do workflow
git commit --allow-empty -m "chore: trigger initial release workflow"
git push origin main
```

**O que vai acontecer:**
1. Workflow `release-changesets.yml` vai detectar changesets pendentes
2. Vai criar um PR "Version Packages" na main
3. PR vai:
   - Atualizar versões nos package.json
   - Atualizar CHANGELOGs
   - Remover o changeset consumido
4. **Ao fazer merge do PR**, os pacotes serão publicados automaticamente no npm

**Vantagem**: Processo seguro com revisão via PR antes da publicação.

#### Estratégia B: Via Tags Manuais (SE CHANGESETS FALHAR)

```bash
# Apenas se a estratégia A não funcionar
# Publicar cada pacote individualmente via tags

cd /workspaces/refarm

# Storage contract
git tag @refarm/storage-contract-v1@0.1.0
git push origin @refarm/storage-contract-v1@0.1.0

# Sync contract
git tag @refarm/sync-contract-v1@0.1.0
git push origin @refarm/sync-contract-v1@0.1.0

# Identity contract
git tag @refarm/identity-contract-v1@0.1.0
git push origin @refarm/identity-contract-v1@0.1.0

# Plugin manifest
git tag @refarm/plugin-manifest@0.1.0
git push origin @refarm/plugin-manifest@0.1.0
```

**Desvantagem**: Menos elegante, requer criação manual de tags para cada pacote.

---

## ✅ Validação de Sucesso

### 6. Verificar publicação no npm

Após merge do PR (Estratégia A) ou push das tags (Estratégia B):

```bash
# Verificar cada pacote foi publicado
npm info @refarm/storage-contract-v1
npm info @refarm/sync-contract-v1
npm info @refarm/identity-contract-v1
npm info @refarm/plugin-manifest

# Todos devem retornar versão 0.1.0
```

### 7. Verificar GitHub Releases

```bash
# Via web: https://github.com/refarm-dev/refarm/releases
# Devem existir 4 releases (um por pacote)
```

### 8. Teste de instalação em projeto externo

```bash
# Em outro diretório (fora do monorepo)
mkdir test-refarm-install && cd test-refarm-install
npm init -y
npm install @refarm/storage-contract-v1 @refarm/plugin-manifest

# Criar teste rápido
cat > test.js << 'EOF'
import { runStorageV1Conformance } from '@refarm/storage-contract-v1';
console.log('✅ Imports funcionando!');
EOF

node test.js
```

Se o teste passar: **🎉 RELEASE BEM-SUCEDIDA!**

---

## 📋 Checklist de Confirmação

Marcar conforme completar:

- [ ] Organização npm `@refarm` criada
- [ ] Token NPM_TOKEN gerado e configurado no GitHub
- [ ] Variable RELEASE_AUTOMATION=true configurada
- [ ] Workflows de teste passando (CI verde)
- [ ] Primeira release executada (Changesets PR merged OU tags pushed)
- [ ] 4 pacotes publicados no npm (validado via `npm info`)
- [ ] 4 GitHub Releases criadas
- [ ] Teste de instalação externa passou

---

## 🆘 Se Algo Der Errado

### Rollback de release acidental

```bash
# Se publicou versão errada, deprecar (NÃO deletar)
npm deprecate @refarm/storage-contract-v1@0.1.0 "Released by mistake, use X.X.X"

# Publicar correção
# Edite package.json com versão correta
npm version patch --no-git-tag-version
git add package.json
git commit -m "fix(storage-contract-v1): correct version"
git tag @refarm/storage-contract-v1@0.1.1
git push origin @refarm/storage-contract-v1@0.1.1
```

### Workflow não está rodando

Verificar:
1. `github.repository_owner` está correto? (deve ser `refarm-dev`)
2. `vars.RELEASE_AUTOMATION` está configurado como `true`?
3. Branch protection está bloqueando? (verificar Settings → Branches)

### npm publish falhou com 403

Verificar:
1. Token NPM_TOKEN tem permissões de Automation + Read/Publish?
2. Token está associado à org `@refarm`?
3. Sua conta npm tem permissões de admin na org `@refarm`?

---

## 📞 Contato

Se houver problemas críticos que bloqueiam a release:

1. **NÃO entre em pânico** — nenhuma ação aqui é irreversível
2. **Documente o erro** (screenshot do workflow + logs)
3. **Não force push** na main
4. **Pergunte no chat** antes de tentar workarounds

---

**Última atualização**: 2026-03-07
**Autor**: GitHub Copilot (preparação pré-transfer)
