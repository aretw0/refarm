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

#### Secrets (sensíveis)

```bash
# Nome: NPM_TOKEN
# Valor: [token gerado no passo 2]
# Scope: Repository secrets
```

#### Variables (não-sensíveis)

```bash
# Nome: RELEASE_AUTOMATION
# Valor: true
# Scope: Repository variables

# Opcional (lock de owner)
# Nome: RELEASE_OWNER
# Valor: refarm-dev
# Scope: Repository variables
```

**⚠️ CRITICAL**: Os workflows só executarão publicações quando:

- `vars.RELEASE_AUTOMATION == 'true'` (configurado manualmente)
- e, se `RELEASE_OWNER` estiver preenchido, `github.repository_owner == vars.RELEASE_OWNER`

---

## 🚀 Primeira Release (5-15 minutos)

### 4. Validar workflows estão funcionando

O transfer do repositório deve ter acionado o workflow de testes automaticamente. Verificar:

```bash
# Via web: https://github.com/aretw0/refarm/actions
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

# Storage contract (scope do profile ativo)
git tag @aretw0/storage-contract-v1@0.1.0
git push origin @aretw0/storage-contract-v1@0.1.0

# Sync contract
git tag @aretw0/sync-contract-v1@0.1.0
git push origin @aretw0/sync-contract-v1@0.1.0

# Identity contract
git tag @aretw0/identity-contract-v1@0.1.0
git push origin @aretw0/identity-contract-v1@0.1.0
```

> Em ambiente de organização, use as tags no scope da organização (ex.: `@refarm.dev/...`).

**Desvantagem**: Menos elegante, requer criação manual de tags para cada pacote.

---

## ✅ Validação de Sucesso

### 6. Verificar publicação no npm

Após merge do PR (Estratégia A) ou push das tags (Estratégia B):

```bash
# Verificar cada pacote foi publicado
npm info @aretw0/storage-contract-v1
npm info @aretw0/sync-contract-v1
npm info @aretw0/identity-contract-v1

# Todos devem retornar versão 0.1.0
```

### 7. Verificar GitHub Releases

```bash
# Via web: https://github.com/aretw0/refarm/releases
# Devem existir 3 releases (um por pacote)
```

### 8. Teste de instalação em projeto externo

```bash
# Em outro diretório (fora do monorepo)
mkdir test-refarm-install && cd test-refarm-install
npm init -y
npm install @aretw0/storage-contract-v1 @aretw0/sync-contract-v1 @aretw0/identity-contract-v1

# Criar teste rápido
cat > test.js << 'EOF'
import { runStorageV1Conformance } from '@aretw0/storage-contract-v1';
console.log('✅ Imports funcionando!');
EOF

node test.js
```

Se o teste passar: **🎉 RELEASE BEM-SUCEDIDA!**

---

## � Limpeza de Documentação (Dia 1-2)

Este é um momento perfeito para remover documentação que não será mais necessária.

### Removed: Migration Guide (File Cleanup)

```bash
# Após verificar que a migração foi bem-sucedida:
rm docs/REPOSITORY_MIGRATION_GUIDE.md
git add docs/
git commit -m "docs: remove migration guide (executed successfully)"
git push origin main
```

**Por quê?** Esse guide foi escrito especificamente para o processo de transfer. Uma vez executado, não tem propósito operacional. A decisão fica documentada em `decision-log.md`.

### Reduce: Research Archive Consolidation (Optional, Parallel)

Se quiser reduzir a "gordura" de documentação agora:

```bash
# 1. Criar novo índice consolidado:
# docs/research/INDEX.md → com referências a ADRs ao invés de repetir conteúdo

# 2. Remover arquivos de research redundantes:
rm docs/research/phase1-technical-foundations.md
rm docs/research/phases2-4-technical-research.md

# 3. Manter como referência histórica:
# - docs/research/browser-extension-discussion.md
# - docs/research/critical-validations.md
# - docs/research/wasm-validation.md
# - docs/research/competitive-analysis.md

# 4. Consolidar status em decision-log:
# Mover conteúdo de docs/ESTADO_ATUAL.md para decision-log.md
rm docs/ESTADO_ATUAL.md

git add docs/
git commit -m "docs: consolidate research into ADR references + move status to decision-log"
git push origin main
```

**Impacto**: Reduz ~2600 linhas de documentação desnecessária (33% menos docs)

**Referência completa**: [docs/DOCUMENTATION_CLEANUP_PLAN.md](DOCUMENTATION_CLEANUP_PLAN.md)

---

## 📋 Checklist de Confirmação

Marcar conforme completar:

### Essencial (Bloqueia Release)

- [ ] Organização npm `@refarm.dev` criada (não @refarm-dev!)
- [ ] Token NPM_TOKEN gerado e configurado no GitHub
- [ ] Variable RELEASE_AUTOMATION=true configurada
- [ ] Workflows de teste passando (CI verde)
- [ ] Primeira release executada (Changesets PR merged OU tags pushed)
- [ ] 4 pacotes publicados no npm (validado via `npm info`)
- [ ] 4 GitHub Releases criadas
- [ ] Teste de instalação externa passou

### Nice-to-Have (Documentação)

- [ ] REPOSITORY_MIGRATION_GUIDE.md deletado
- [ ] Research consolidado em INDEX.md (opcional)
- [ ] ESTADO_ATUAL.md consolidado em decision-log.md (opcional)
- [ ] Encontrados e atualizados todas referências `aretw0` → `refarm-dev`

---

## 🆘 Se Algo Der Errado

### Rollback de release acidental

```bash
# Se publicou versão errada, deprecar (NÃO deletar)
npm deprecate @refarm.dev/storage-contract-v1@0.1.0 "Released by mistake, use X.X.X"

# Publicar correção
# Edite package.json com versão correta
npm version patch --no-git-tag-version
git add package.json
git commit -m "fix(storage-contract-v1): correct version"
git tag @refarm.dev/storage-contract-v1@0.1.1
git push origin @refarm.dev/storage-contract-v1@0.1.1
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
