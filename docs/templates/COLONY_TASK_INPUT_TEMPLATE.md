# Colony Task Input Template

## Task
- ID: `<T-...>`
- Objective: `<resultado único esperado>`

## Scope
- Allowed paths:
  - `<path>`
- Out of scope:
  - `dist/`, `build/`, `.turbo/`, artefatos gerados

## Constraints
- Source Sovereignty
- Sem mudanças fora do domínio sem escalonamento
- Commits atômicos

## Validation
- Smoke commands:

```bash
<command>
```

- Full command (se aplicável):

```bash
<command>
```

## Escalation
Pare e peça revisão humana se:
- houver bloqueio de preflight;
- houver colisão em área serializada;
- faltar decisão arquitetural registrada.
