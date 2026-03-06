# Branch Protection Rules Configuration

Este guia mostra como configurar as regras de proteção de branch no GitHub para garantir qualidade de código.

## Acesso via GitHub UI

1. Acesse o repositório no GitHub
2. Vá para: **Settings** → **Branches** → **Add rule**
3. Configure conforme instruções abaixo

---

## Configuração para Branch `main`

### 1. Branch Name Pattern

```
main
```

### 2. ✅ Require a pull request before merging

**Configurações:**
- [x] Require approvals: **1**
- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require review from Code Owners (se usar CODEOWNERS)

**Por quê:** Garante que todo código seja revisado por pelo menos uma pessoa antes do merge.

---

### 3. ✅ Require status checks to pass before merging

**Configurações:**
- [x] Require branches to be up to date before merging

**Status checks obrigatórios (adicione todos):**

```
quality           # Lint, type-check, unit tests, integration tests, security audit
build             # Build validation
e2e               # End-to-end tests (se aplicável)
check-changeset   # Changeset validation
```

**Como adicionar:**
1. Primeiro, execute os workflows no repositório (para que apareçam na lista)
2. Digite o nome do job no campo de busca
3. Clique para adicionar cada um

**Por quê:** Bloqueia merge se testes, lint, build ou changeset falharem.

---

### 4. ✅ Require conversation resolution before merging

**Configurações:**
- [x] Require conversation resolution before merging

**Por quê:** Garante que todos os comentários de revisão sejam endereçados antes do merge.

---

### 5. ✅ Restrict who can push to matching branches

**Configurações:**
- [x] Restrict pushes that create matching branches (opcional)
- Adicione usuários/equipes permitidos (se aplicável)

**Por quê:** Previne pushes diretos para `main`, forçando uso de PRs.

---

### 6. ✅ Do not allow bypassing the above settings

**Configurações:**
- [x] Do not allow bypassing the above settings

**Por quê:** Garante que nem administradores possam pular as regras de qualidade.

---

### 7. ✅ Allow force pushes (Configurar com cuidado)

**Configurações:**
- [ ] Allow force pushes: **Desabilitado** (recomendado para `main`)

**Por quê:** Force pushes podem reescrever histórico e quebrar rastreabilidade.

---

### 8. ✅ Allow deletions

**Configurações:**
- [ ] Allow deletions: **Desabilitado** (recomendado para `main`)

**Por quê:** Previne deleção acidental da branch principal.

---

## Configuração para Branch `develop`

Repita as mesmas configurações de `main`, mas com algumas flexibilizações opcionais:

**Diferenças permitidas:**
- Approvals: **1** (mesmo critério)
- Status checks: **Mesmos** (qualidade não negocia)
- Force pushes: **Permitido** para mantenedores (se necessário para rebase)

---

## Verificação de Status Checks

### Como ver se os checks estão configurados corretamente?

1. Abra um PR de teste
2. Vá até a aba **Checks**
3. Verifique se os seguintes aparecem:
   - ✅ quality
   - ✅ build
   - ✅ e2e (se aplicável)
   - ✅ check-changeset

### Se algum check não aparecer:

**Causa comum:** Workflow não rodou ainda ou nome do job está incorreto

**Solução:**
1. Execute o workflow manualmente via **Actions** → **workflow** → **Run workflow**
2. Após execução bem-sucedida, o check aparecerá na lista de status checks disponíveis
3. Adicione-o às branch protection rules

---

## Configuração via GitHub GraphQL API (Automação)

Se quiser automatizar via script:

```bash
# Requer GitHub CLI (gh)
gh api graphql -f query='
mutation {
  createBranchProtectionRule(input: {
    repositoryId: "REPOSITORY_NODE_ID"
    pattern: "main"
    requiresApprovingReviews: true
    requiredApprovingReviewCount: 1
    requiresStatusChecks: true
    requiresStrictStatusChecks: true
    requiredStatusCheckContexts: ["quality", "build", "e2e", "check-changeset"]
    requiresConversationResolution: true
    isAdminEnforced: true
    allowsForcePushes: false
    allowsDeletions: false
  }) {
    branchProtectionRule {
      id
      pattern
    }
  }
}
'
```

**Obter Repository Node ID:**
```bash
gh api /repos/OWNER/REPOSITORY --jq .node_id
```

---

## Configuração via Terraform (Infraestrutura como Código)

Se usar Terraform para gerenciar GitHub:

```hcl
resource "github_branch_protection" "main" {
  repository_id = github_repository.refarm.node_id
  pattern       = "main"

  required_status_checks {
    strict   = true
    contexts = [
      "quality",
      "build",
      "e2e",
      "check-changeset"
    ]
  }

  required_pull_request_reviews {
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = true
    required_approving_review_count = 1
  }

  require_conversation_resolution = true
  enforce_admins                  = true
  allows_force_pushes             = false
  allows_deletions                = false
}

resource "github_branch_protection" "develop" {
  repository_id = github_repository.refarm.node_id
  pattern       = "develop"

  required_status_checks {
    strict   = true
    contexts = [
      "quality",
      "build",
      "e2e",
      "check-changeset"
    ]
  }

  required_pull_request_reviews {
    dismiss_stale_reviews           = true
    required_approving_review_count = 1
  }

  require_conversation_resolution = true
  enforce_admins                  = true
  allows_force_pushes             = true  # Permitido para mantenedores
  allows_deletions                = false
}
```

---

## Testando Branch Protection

### Como testar se está funcionando?

1. **Criar PR sem changeset:**
   - Alterar código sem adicionar changeset
   - Verificar se check `check-changeset` falha
   - Verificar se comentário automático aparece no PR

2. **Criar PR com lint quebrado:**
   - Adicionar código com erro de lint
   - Tentar dar push (deve falhar no pre-push hook)
   - Se passar hook (com --no-verify), CI deve falhar

3. **Tentar merge com checks falhando:**
   - Verificar se botão "Merge" está desabilitado
   - Verificar mensagem: "Required status checks must pass before merging"

4. **Tentar push direto para main:**
   - `git push origin main` (deve falhar)
   - Verificar mensagem: "Branch 'main' is protected"

---

## Labels do GitHub

Criar estes labels no repositório para controle:

| Label | Cor | Descrição |
|-------|-----|-----------|
| `skip-changeset` | `#FBCA04` (amarelo) | Skip changeset requirement (internal changes) |
| `breaking-change` | `#D73A4A` (vermelho) | Breaking change requiring major version bump |
| `needs-review` | `#0075CA` (azul) | Awaiting code review |
| `ready-to-merge` | `#0E8A16` (verde) | All checks passed, ready for merge |

**Criar via GitHub CLI:**
```bash
gh label create "skip-changeset" --color "FBCA04" --description "Skip changeset requirement"
gh label create "breaking-change" --color "D73A4A" --description "Breaking change"
gh label create "needs-review" --color "0075CA" --description "Awaiting code review"
gh label create "ready-to-merge" --color "0E8A16" --description "Ready to merge"
```

---

## Troubleshooting

### Problema: Status check não aparece na lista

**Solução:**
1. Execute o workflow manualmente
2. Aguarde conclusão (sucesso ou falha)
3. Recarregue página de branch protection
4. Check deve aparecer agora

### Problema: Merge bloqueado mesmo com checks passando

**Causas possíveis:**
- Branch desatualizada com base → Atualizar com merge/rebase
- Comentários não resolvidos → Resolver todos os threads
- Approval faltando → Solicitar revisão

### Problema: Pre-push hook não está rodando

**Solução:**
```bash
# Reinstalar hooks
npm run hooks:install

# Verificar se foi instalado
ls -lh .git/hooks/pre-push
```

---

## Referências

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)
- [Terraform GitHub Provider](https://registry.terraform.io/providers/integrations/github/latest/docs/resources/branch_protection)
