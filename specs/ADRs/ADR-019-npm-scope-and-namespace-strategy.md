# ADR-019: npm Scope and Namespace Strategy

**Status**: Accepted  
**Date**: 2026-03-07  
**Deciders**: Core Team  
**Tags**: #distribution #branding #infrastructure

---

## Context

Com a preparação para distribuição pública dos capability contracts (`storage-contract-v1`, `sync-contract-v1`, `identity-contract-v1`, `plugin-manifest`), precisamos definir o **npm scope** que será usado para publicação dos pacotes.

### Restrições Identificadas

1. **`@refarm` não está disponível** no npm registry
2. **GitHub org é `refarm-dev`** (namespace técnico escolhido)
3. **Domínio principal é `refarm.dev`** (marca/marketing)
4. Duas organizações npm foram criadas como fallback:
   - `@refarm.dev`
   - `@refarm-dev`

### Considerações de Branding

- **Consistência com domínio**: `refarm.dev` é o domínio público principal
- **Separação de concerns**: GitHub org (`refarm-dev`) é técnico/infra, npm scope deve ser orientado a usuários
- **Memorabilidade**: Qual scope é mais intuitivo para devs externos?

---

## Decision

**Escolhemos `@refarm.dev` como npm scope principal para publicação de pacotes.**

Pacotes públicos serão distribuídos como:
- `@refarm.dev/storage-contract-v1`
- `@refarm.dev/sync-contract-v1`
- `@refarm.dev/identity-contract-v1`
- `@refarm.dev/plugin-manifest`

**`@refarm-dev` será mantido apenas como proteção de namespace** (reservado, sem publicações).

---

## Rationale

### Vantagens do `@refarm.dev`

1. ✅ **Alinhamento com marca**: Diretamente relacionado ao domínio `refarm.dev`
2. ✅ **Clareza semântica**: `.dev` indica natureza de ferramenta de desenvolvimento
3. ✅ **Consistência externa**: Usuários associam `refarm.dev` (site/docs) com `@refarm.dev` (pacotes)
4. ✅ **Diferenciação técnica**: GitHub org mantém `-dev` (infra), npm usa `.dev` (produto)

### Desvantagens e Mitigações

#### ⚠️ **Caveat 1: Pontos em npm scopes são incomuns**

**Problema**: Embora válidos segundo [npm naming rules](https://docs.npmjs.com/cli/v10/using-npm/scope), scopes com pontos podem causar problemas em ferramentas antigas ou com parsing simplista.

**Ambientes afetados**:
- Sistemas de build pré-2020 (Webpack < 5, Rollup < 2)
- Scripts de CI/CD com regex simples como `/^@([a-z0-9-]+)\//`
- Ferramentas proprietárias sem suporte a RFC-compliant package names

**Mitigação**:
1. **Público-alvo moderno**: Refarm targets Node 22+, ecossistema recente já suporta
2. **Testes de conformidade**: Validar em CI que pacotes instalam corretamente
3. **Fallback pronto**: `@refarm-dev` já reservado como escape hatch
4. **Documentação explícita**: Instruir devs sobre possíveis problemas

#### ⚠️ **Caveat 2: TypeScript paths requer aspas**

**Problema**: Em `tsconfig.json`, paths com pontos precisam estar entre aspas.

```json
// ❌ Inválido
{
  "paths": {
    @refarm.dev/*: ["./packages/*/src"]
  }
}

// ✅ Válido
{
  "paths": {
    "@refarm.dev/*": ["./packages/*/src"]
  }
}
```

**Mitigação**: Todos os `tsconfig.json` do monorepo já usam aspas (padrão seguido).

#### ⚠️ **Caveat 3: Regex de parsing podem falhar**

**Problema**: Pacotes que fazem parsing de `package.json` com regex simples podem não extrair corretamente o scope.

**Exemplo de regex problemática**:
```javascript
// ❌ Falha com pontos
const match = packageName.match(/^@([a-z-]+)\/(.+)$/);

// ✅ Funciona
const match = packageName.match(/^@([a-z0-9.-]+)\/(.+)$/);
```

**Mitigação**: 
- Não controlamos ferramentas de terceiros
- Ferramentas mainstream (npm, yarn, pnpm, TypeScript) suportam corretamente
- Se emergir como problema crítico, migração para `@refarm-dev` é viável

---

## Consequences

### Positivas

- ✅ Marca consistente (`refarm.dev` em todos os touchpoints externos)
- ✅ Documentação e comunicação simplificadas
- ✅ Diferenciação clara entre namespaces técnicos (GitHub) e de produto (npm)

### Negativas (Aceitáveis)

- ⚠️ Possível incompatibilidade com ferramentas legadas (edge case)
- ⚠️ Precisa documentar caveats para evitar surpresas
- ⚠️ Requer disciplina em manter aspas em todos os `tsconfig.json` paths

### Neutras

- 🔄 Migração futura para `@refarm-dev` é possível via npm deprecation + republish
- 🔄 Ambos os scopes já estão reservados, sem risco de namespace squatting

---

## Compliance

### npm Registry Rules ✅

Segundo [npm org scopes documentation](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages):
> "Scope names must be lowercase and URL-safe, matching the regex `/^[a-z0-9][a-z0-9._-]*$/`"

`refarm.dev` ✅ Válido (lowercase, contém apenas `.` permitido)

### TypeScript Compatibility ✅

TypeScript suporta paths com pontos entre aspas desde versão 2.0+ (2016).

### Node.js Module Resolution ✅

Node.js ESM e CommonJS resolvem corretamente scopes com pontos (testado em Node 18+).

---

## Implementation Notes

### Package Naming Pattern

```
@refarm.dev/<package-name>@<version>
```

**Exemplos**:
- `@refarm.dev/storage-contract-v1@0.1.0`
- `@refarm.dev/plugin-manifest@0.2.0`

### Git Tag Pattern

Tags para release automation seguem o mesmo padrão:
```
@refarm.dev/storage-contract-v1@0.1.0
```

### TypeScript Paths Configuration

```json
{
  "compilerOptions": {
    "paths": {
      "@refarm.dev/storage-contract-v1": ["./packages/storage-contract-v1/dist/index.d.ts"],
      "@refarm.dev/*": ["./packages/*/src"]
    }
  }
}
```

**Atenção**: Sempre usar aspas duplas nos path mappings.

---

## Rollback Strategy

Se `@refarm.dev` provar-se problemático em produção:

1. **Publicar versões idênticas em `@refarm-dev`**:
   ```bash
   npm publish @refarm.dev/storage-contract-v1 --tag latest
   npm publish @refarm-dev/storage-contract-v1 --tag latest
   ```

2. **Deprecar versões antigas**:
   ```bash
   npm deprecate @refarm.dev/storage-contract-v1 "Migrated to @refarm-dev/storage-contract-v1"
   ```

3. **Atualizar documentação apontando para novo scope**

4. **Manter aliases por 6+ meses** antes de remoção definitiva

**Custo estimado**: 2-3 sprints (re-publicação, docs, comunicação com early adopters).

---

## Alternatives Considered

### Option 1: `@refarm-dev` (GitHub-aligned)

**Pros**:
- ✅ Consistente com GitHub org
- ✅ Sem caveats técnicos (hífen é universalmente suportado)

**Cons**:
- ❌ Desalinhado com domínio principal (`refarm.dev`)
- ❌ `-dev` suggere "development/unstable", não é intuitivo para pactes stable

**Rejected**: Prioridade para branding externo sobre consistência interna.

### Option 2: `@refarmdev` (sem separador)

**Pros**:
- ✅ Sem caveats técnicos
- ✅ Simples e direto

**Cons**:
- ❌ Menos legível (`refarmdev` vs `refarm.dev`)
- ❌ Não estava disponível no npm

**Rejected**: Indisponível + legibilidade inferior.

### Option 3: Dual-publish em ambos os scopes

**Pros**:
- ✅ Flexibilidade máxima
- ✅ Usuários escolhem preferência

**Cons**:
- ❌ Complexidade operacional dobrada
- ❌ Fragmentação de estatísticas npm
- ❌ Confusão sobre qual é "oficial"

**Rejected**: Overhead operacional não justificado.

---

## References

- [npm scopes documentation](https://docs.npmjs.com/cli/v10/using-npm/scope)
- [Package name guidelines](https://docs.npmjs.com/package-name-guidelines)
- [TypeScript paths mapping](https://www.typescriptlang.org/tsconfig#paths)
- [Node.js ESM resolution](https://nodejs.org/api/esm.html#resolution-algorithm)
- Internal: `docs/POST_TRANSFER_CHECKLIST.md` (implementação)
- Internal: `.github/workflows/publish-packages.yml` (automação)

---

## Approval

**Decision maker**: @aretw0 (maintainer)  
**Reviewed by**: GitHub Copilot (architectural advisor)  
**Date**: 2026-03-07

---

## Changelog

- **2026-03-07**: Initial decision (ADR-019 created)
- **Future**: If rollback needed, add addendum here

