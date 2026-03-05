# Segurança

## Status das Dependências

### Vulnerabilidades Conhecidas (npm audit)

Atualizado em: 4 de março de 2026

#### Estado Atual: ✅ Seguro para Produção

As vulnerabilidades reportadas pelo `npm audit` afetam **apenas dependências de desenvolvimento** e não impactam o código em produção.

---

### 🟡 Vulnerabilidades Documentadas

#### 1. **svgo** - DoS (Alta Severidade)

- **Status:** Monitorando
- **Contexto:** Ferramenta de otimização de SVG usada no build
- **Impacto:** Build process apenas, não afeta runtime
- **Ação:** Aguardando atualização upstream ou correção via `npm audit fix`

#### 2. **lodash** - Prototype Pollution (Moderada Severidade)

- **Status:** Aguardando atualização upstream
- **Contexto:** Dependência transitiva do `@astrojs/check`

  ```
  @astrojs/check → @astrojs/language-server → 
  volar-service-yaml → yaml-language-server → lodash (v4.17.21)
  ```

- **Impacto:** Tooling de desenvolvimento (type checking), não afeta produção
- **Ação:** Aguardar atualização do Astro. Correção via `npm audit fix --force` causaria breaking changes

---

## Para Desenvolvedores

### Ao ver vulnerabilidades no npm install

```bash
npm audit
```

**Não se assuste!** As vulnerabilidades listadas acima são conhecidas e documentadas. Elas:

- ✅ Não afetam o código em produção
- ✅ Estão limitadas a dev dependencies
- ✅ Estão sendo monitoradas para correção

### Workflow de Segurança

1. **Verificação periódica:** CI/CD roda `npm audit` automaticamente
2. **Atualizações:** Script `npm run deps:update` verifica atualizações disponíveis
3. **Revisão:** Vulnerabilidades são revisadas a cada atualização de dependências

---

## Reportar Vulnerabilidades

Se você descobrir uma vulnerabilidade de segurança no código do Refarm (não em dependências), por favor:

1. **NÃO** abra uma issue pública
2. Entre em contato diretamente com os mantenedores
3. Forneça o máximo de detalhes possível sobre a vulnerabilidade

---

## Recursos

- [npm audit documentation](https://docs.npmjs.com/cli/v10/commands/npm-audit)
- [Dependabot alerts](https://docs.github.com/en/code-security/dependabot/dependabot-alerts)
- [GitHub Security Advisories](https://github.com/advisories)
