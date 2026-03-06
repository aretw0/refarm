# PR Quality Governance

## Objetivos

Este documento define as políticas e mecanismos de controle de qualidade para Pull Requests, garantindo que:

1. ✅ **PRs não sejam abertos com pipeline quebrada** (testes, lint, type-check)
2. ✅ **PRs contenham changeset** quando necessário (para versionamento)
3. ✅ **Issues não sejam criadas descontroladamente** em workflows

---

## 1. Entendendo a Política Atual de Issues

### ✅ Comportamento Seguro (Já Implementado)

**Issues são criadas APENAS em:**
- 🕐 Workflows agendados (`schedule`) — execuções semanais programadas
- 🖱️ Workflows manuais (`workflow_dispatch`) — execuções via UI do GitHub Actions

**Issues NÃO são criadas em:**
- ❌ Pull Requests — workflows apenas **falham checks**, não criam issues
- ❌ Pushes para branches — workflows apenas reportam falhas nos logs
- ❌ Merge commits — nenhuma criação automática

### Como isso funciona?

Todos os workflows reutilizáveis usam esta condição:

```yaml
create-issue-on-failure: ${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}
```

**Exemplo (validate-diagrams.yml):**
```yaml
jobs:
  validate:
    uses: ./.github/workflows/reusable-validate-docs.yml
    with:
      validation-command: npm run diagrams:check -- --ci
      validation-name: Diagrams
      create-issue-on-failure: ${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}
```

**Resultado:**
- ✅ Se rodar no schedule (segunda-feira 09:00 UTC) → cria issue se falhar
- ✅ Se rodar manualmente via Actions UI → cria issue se falhar
- ❌ Se rodar em PR → apenas falha o check, **sem criar issue**

### Por que issues em agendamentos?

Issues em workflows agendados são **desejáveis** porque:
- 📊 Rastreiam problemas que surgem ao longo do tempo (dependências desatualizadas, vulnerabilidades novas)
- 🔔 Alertam a equipe sobre degradação gradual
- 📝 Centralizam discussão sobre como resolver o problema

---

## 2. Branch Protection Rules (GitHub)

### Bloqueio de Merge (Não de Criação de PR)

O GitHub **não permite bloquear a criação de PRs**, mas pode **bloquear o merge** até que condições sejam satisfeitas.

### Configuração Recomendada

Via GitHub UI: **Settings → Branches → Add rule** para `main` e `develop`:

```yaml
Branch name pattern: main
```

**Regras obrigatórias:**

1. ✅ **Require a pull request before merging**
   - Require approvals: `1`
   - Dismiss stale pull request approvals when new commits are pushed

2. ✅ **Require status checks to pass before merging**
   - Require branches to be up to date before merging
   - Status checks required:
     - `quality` (lint, type-check, tests, security)
     - `build` (validação de build)
     - `e2e` (testes end-to-end, se aplicável)

3. ✅ **Require conversation resolution before merging**
   - Todos os comentários devem ser resolvidos

4. ✅ **Do not allow bypassing the above settings**
   - Garante que nem administradores pulem as regras

### Configuração via Código (GitHub Apps/Terraform)

Se usar infraestrutura como código:

```hcl
resource "github_branch_protection" "main" {
  repository_id = github_repository.refarm.node_id
  pattern       = "main"

  required_status_checks {
    strict   = true
    contexts = ["quality", "build", "e2e"]
  }

  required_pull_request_reviews {
    dismiss_stale_reviews           = true
    required_approving_review_count = 1
  }

  require_conversation_resolution = true
  enforce_admins                  = true
}
```

---

## 3. Validação Local (Pre-Push Hooks)

### Por que hooks locais?

Bloquear problemas **antes do push** economiza:
- ⏱️ Tempo de CI/CD (não precisa rodar pipeline para descobrir erro óbvio)
- 💰 Recursos de runner GitHub Actions
- 🧠 Contexto mental (não precisa esperar CI falhar para corrigir)

### Implementação com Git Hooks Nativos

**Arquivo: `.git/hooks/pre-push`** (criado automaticamente via script)

**Política local atual (branch-aware):**

- `main` / `develop`: bloqueia push somente se `lint` ou `type-check` falharem
- Feature branches: não bloqueia push (warnings)
- `test:unit` e `npm audit --audit-level=high`: warnings locais, enforcement no CI

**Política local atual (branch-aware):**

- `main` / `develop`: bloqueia push somente se `lint` ou `type-check` falharem
- Feature branches: não bloqueia push (gera warnings)
- `test:unit` e segurança (`npm audit --audit-level=high`): warnings locais, gate obrigatório no CI

**Observação:** o CI continua sendo a autoridade final para merge (required status checks).

```bash
#!/bin/sh
# Pre-push hook: valida qualidade antes de push

echo "🔍 Running pre-push validation..."

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Strict only on protected branches
case "$CURRENT_BRANCH" in
  main|develop) IS_STRICT=1 ;;
  *) IS_STRICT=0 ;;
esac

# 1. Lint
echo "📝 Checking lint..."
npm run lint || {
  if [ "$IS_STRICT" -eq 1 ]; then
    echo "❌ Lint failed (blocking in strict mode)."
    exit 1
  fi
  echo "⚠️ Lint failed (warning in permissive mode)."
}

# 2. Type-check
echo "🔤 Checking types..."
npm run type-check || {
  if [ "$IS_STRICT" -eq 1 ]; then
    echo "❌ Type-check failed (blocking in strict mode)."
    exit 1
  fi
  echo "⚠️ Type-check failed (warning in permissive mode)."
}

# 3. Unit tests
echo "🧪 Running unit tests..."
npm run test:unit || {
  echo "⚠️ Tests failed (non-blocking local warning)."
}

# 4. Security audit (high/critical only)
echo "🔒 Checking security..."
npm audit --audit-level=high || {
  echo "⚠️ Security audit warning locally. CI remains the enforcement gate."
}

echo "✅ Local pre-push execution complete."
```

### Instalação do Hook

Adicionar script no `package.json`:

```json
{
  "scripts": {
    "hooks:install": "node scripts/install-git-hooks.mjs"
  }
}
```

**Arquivo: `scripts/install-git-hooks.mjs`**

```javascript
import { writeFileSync, chmodSync } from 'fs';
import { join } from 'path';

const hookContent = `#!/bin/sh
# Pre-push hook: valida qualidade antes de push

echo "🔍 Running pre-push validation..."

# 1. Lint
echo "📝 Checking lint..."
npm run lint || {
  echo "❌ Lint failed! Fix issues before pushing."
  exit 1
}

# 2. Type-check
echo "🔤 Checking types..."
npm run type-check || {
  echo "❌ Type check failed! Fix type errors before pushing."
  exit 1
}

# 3. Unit tests (advisory)
echo "🧪 Running unit tests..."
npm run test:unit || echo "⚠️ Unit tests failed (warning local, gate in CI)."

# 4. Security audit (advisory)
echo "🔒 Checking security..."
npm audit --audit-level=high || echo "⚠️ Security warning local, gate in CI."

echo "✅ Local pre-push execution complete"
`;

const hookPath = join('.git', 'hooks', 'pre-push');

try {
  writeFileSync(hookPath, hookContent, 'utf8');
  chmodSync(hookPath, 0o755);
  console.log('✅ Git pre-push hook installed successfully!');
  console.log('   Hook will run automatically before every push.');
} catch (error) {
  console.error('❌ Failed to install pre-push hook:', error.message);
  process.exit(1);
}
```

### Executar na Post-Create

Adicionar no `.devcontainer/post-create.sh`:

```bash
# Install git hooks
npm run hooks:install
```

---

## 4. Validação de Changeset

### Por que exigir changeset?

Changesets garantem:
- 📝 Versionamento semântico correto
- 📋 Changelog automático
- 🔢 Releases consistentes

### Quando changeset é necessário?

**Necessário:**
- ✅ Novos features (minor bump)
- ✅ Bug fixes (patch bump)
- ✅ Breaking changes (major bump)
- ✅ Mudanças em packages públicos

**Não necessário:**
- ❌ Documentação apenas (`.md`, `.txt`)
- ❌ Configuração de CI/CD (`.github/workflows`)
- ❌ Tooling interno (`scripts/`, `validations/`)
- ❌ Testes apenas (`*.test.ts`, `*.spec.ts`)

### Workflow de Validação

**Arquivo: `.github/workflows/validate-changeset.yml`**

```yaml
name: Validate Changeset

on:
  pull_request:
    branches: [main, develop]
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  check-changeset:
    runs-on: ubuntu-latest
    steps:
      - name: Setup
        uses: ./.github/actions/setup
        with:
          fetch-depth: "0"

      - name: Check for changeset
        id: changeset-check
        run: |
          # Check if PR contains code changes (not just docs/CI)
          CHANGED_FILES=$(git diff --name-only origin/${{ github.base_ref }}...HEAD)
          
          # Skip if only docs, CI, or test files
          if echo "$CHANGED_FILES" | grep -qvE '\.(md|txt|yml|yaml)$|^\.github/|^scripts/|^validations/|\.test\.|\.spec\.'; then
            echo "code-changed=true" >> $GITHUB_OUTPUT
          else
            echo "code-changed=false" >> $GITHUB_OUTPUT
            echo "ℹ️ Only documentation/CI/test files changed, skipping changeset check"
            exit 0
          fi

      - name: Verify changeset exists
        if: steps.changeset-check.outputs.code-changed == 'true'
        run: |
          if [ ! -d ".changeset" ] || [ -z "$(ls -A .changeset/*.md 2>/dev/null | grep -v README.md)" ]; then
            echo "❌ No changeset found! Please run 'npm run changeset' to document your changes."
            echo ""
            echo "Quick guide:"
            echo "  npm run changeset"
            echo "  git add .changeset/*.md"
            echo "  git commit -m 'docs: add changeset'"
            echo "  git push"
            exit 1
          fi
          echo "✅ Changeset found"

      - name: Comment on PR (if missing)
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## ⚠️ Changeset Required

This PR modifies code but does not include a changeset.

**To fix:**
\`\`\`bash
npm run changeset
# Follow the prompts to document your changes
git add .changeset/*.md
git commit -m "docs: add changeset"
git push
\`\`\`

**Learn more:** [Changeset Documentation](https://github.com/changesets/changesets)`
            })
```

### Adicionar ao Branch Protection

No GitHub UI, adicione o check `check-changeset` aos required status checks.

---

## 5. Prevenindo Issues em PRs que Falham Após Update

### Cenário

1. PR é aberto com pipeline passando ✅
2. Branch `main` é atualizada com novos commits
3. PR agora está desatualizado e **falha** ao rodar checks ❌
4. **Questão:** Devemos criar issue quando PR falha após update?

### Resposta: Não

**PRs nunca criam issues**, mesmo após falhar por desatualização. Isso é **correto** porque:

- 🎯 Responsabilidade do autor do PR corrigir
- 🔄 Issue seria duplicada (múltiplos PRs podem falhar pelo mesmo motivo)
- 📬 Notificações do GitHub já alertam autor do PR

### O que acontece na prática

1. **PR fica desatualizado** → GitHub mostra banner "This branch is out-of-date"
2. **Autor atualiza branch** → Merge ou rebase de `main`
3. **Checks rodam novamente** → Se falharem, apenas marcam o check como ❌
4. **Sem issue criada** → Autor corrige diretamente no PR

### Controle de Notificações

Se receber muitas notificações de checks falhando:

**GitHub UI:**
- Settings → Notifications → Actions
- Uncheck: "Actions workflows: Send notifications for failed workflows only you have triggered"

**CODEOWNERS:**
```
# Apenas notificar donos de área específica
/apps/kernel/**            @username-kernel
/packages/identity-nostr/** @username-identity
```

---

## 6. Resumo da Governança

### ✅ O que está protegido

| Situação | Comportamento | Issues criadas? |
|----------|---------------|-----------------|
| PR aberto com código quebrado | Checks falham ❌ | ❌ Não |
| Push para branch com código quebrado | Checks falham ❌ | ❌ Não |
| PR sem changeset | Check falha ❌ | ❌ Não (apenas comentário) |
| Workflow agendado falha | Check falha ❌ | ✅ Sim (rastreamento) |
| Workflow manual falha | Check falha ❌ | ✅ Sim (rastreamento) |
| PR desatualizado após merge de main | Checks falham ❌ | ❌ Não |

### 🔒 Camadas de Proteção

1. **Local (Pre-Push Hook)** — Bloqueia push se lint/tests/types falharem
2. **CI/CD (Required Checks)** — Bloqueia merge se pipeline falhar
3. **Branch Protection** — Exige aprovação + checks passando
4. **Changeset Validation** — Exige documentação de mudanças
5. **Scheduled Issues** — Alerta sobre degradação ao longo do tempo

### 📋 Checklist para Revisar PR

- [ ] Todos os checks passando ✅
- [ ] Changeset incluído (se código mudou)
- [ ] Pelo menos 1 aprovação
- [ ] Comentários resolvidos
- [ ] Branch atualizada com base (main/develop)

---

## 7. Próximos Passos

### Para Implementar Agora

1. ✅ Instalar pre-push hook: `npm run hooks:install`
2. ✅ Criar workflow `validate-changeset.yml`
3. ✅ Configurar branch protection rules no GitHub
4. ✅ Documentar no onboarding (`CONTRIBUTING.md`)

### Para Melhorar no Futuro

- [ ] **Danger.js** — Comentários automatizados em PRs (lembrar de adicionar changeset)
- [ ] **Renovate/Dependabot** — Atualizações automáticas de dependências
- [ ] **SonarQube** — Análise estática de código (code smells, duplicação)
- [ ] **Codecov** — Requisito mínimo de cobertura de testes

---

## Referências

- [GitHub Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Changesets Documentation](https://github.com/changesets/changesets)
- [Git Hooks Documentation](https://git-scm.com/docs/githooks)
- [GitHub Actions: workflow_dispatch](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_dispatch)
