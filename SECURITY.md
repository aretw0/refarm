# Segurança

## Escopo Deste Documento

Este arquivo define a política de segurança e o processo de divulgação responsável.

Para evitar duplicação e desatualização:

- **Fonte de verdade para status de dependências (`npm audit`)**: `docs/DEVOPS.md`
- **Fonte de verdade para reporte de vulnerabilidades**: este arquivo (`SECURITY.md`)

---

## Dependências e Vulnerabilidades

Não mantenha inventário de CVEs aqui.

Consulte sempre:

- `docs/DEVOPS.md` (seção de Security & Vulnerability Management)

Esse é o documento que contém:

- status atual de severidade
- critérios de aceitação temporária de risco
- gatilhos de escalonamento
- cadência de revisão

---

## Para Desenvolvedores

### Verificação Local

```bash
npm audit
```

### Como interpretar

- Vulnerabilidades em tooling/dev dependency podem ser aceitas temporariamente se documentadas em `docs/DEVOPS.md`
- Vulnerabilidades `high`/`critical` devem ser tratadas como bloqueadoras
- O CI é a validação final de merge

---

## Reportar Vulnerabilidades (Responsible Disclosure)

Se você descobrir uma vulnerabilidade no código do Refarm (não apenas em dependências transitivas de tooling):

1. **Não** abra issue pública
2. Contate os mantenedores em canal privado
3. Inclua passos de reprodução, impacto e possível mitigação

---

## Recursos

- [npm audit documentation](https://docs.npmjs.com/cli/v10/commands/npm-audit)
- [Dependabot alerts](https://docs.github.com/en/code-security/dependabot/dependabot-alerts)
- [GitHub Security Advisories](https://github.com/advisories)
