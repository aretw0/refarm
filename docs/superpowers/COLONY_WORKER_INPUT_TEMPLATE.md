# Colony Worker Input Template (Refarm)

Use este template como entrada padrão para workers da colônia.

## 1) Objective

- Task ID: `<T-...>`
- Goal (single outcome): `<resultado esperado em 1 frase>`

## 2) Scope

- Allowed files/packages:
  - `<path 1>`
  - `<path 2>`
- Out of scope:
  - `dist/`, `build/`, `.turbo/`, arquivos gerados

## 3) Constraints

- Source Sovereignty: editar somente fonte (`src/`, docs, configs)
- Não alterar contratos fora do escopo sem abrir follow-up
- Commits atômicos e pequenos

## 4) Validation

Smoke obrigatório:

```bash
<command-1>
<command-2>
```

Full gate (quando aplicável):

```bash
<command-full>
```

## 5) Expected response format

- Summary of changes
- Files changed
- Validation evidence (commands + result)
- Risks / follow-ups

## 6) Escalation criteria (stop and ask)

Escalar para humano quando:
- houver conflito em áreas serializadas (`packages/tractor*`, `.project/**`, workflows)
- depender de decisão arquitetural não registrada
- falha persistente de preflight/toolchain
