# scaffold: @refarm.dev/deps integration no generator

## Contexto

O `@refarm.dev/deps` foi introduzido em 2026-05-17 como declaração soberana dos
primitivos de runtime do ecossistema Refarm:

| Primitivo | Pacote |
|---|---|
| WASM runtime | `@bytecodealliance/jco` |
| Identidade criptográfica | `@noble/ed25519` |
| Protocolo Nostr | `nostr-tools` |
| Sync via git | `isomorphic-git` |
| Transporte WebSocket | `ws` |

Pacotes que usam qualquer desses primitivos devem declarar
`@refarm.dev/deps: workspace:*` como devDep. Hoje isso é feito
manualmente após scaffold.

## Gap

`pnpm turbo gen package` não pergunta quais primitivos o novo pacote
vai usar. O desenvolvedor precisa lembrar de adicionar `@refarm.dev/deps`
manualmente.

## Comportamento desejado

O generator acrescenta um prompt após o tipo de pacote:

```
? Which runtime primitives will this package use? (Space to select, Enter to skip)
❯ ◯ @bytecodealliance/jco  (WASM runtime)
  ◯ @noble/ed25519          (cryptographic identity)
  ◯ nostr-tools             (Nostr protocol)
  ◯ isomorphic-git          (git sync)
  ◯ ws                      (WebSocket transport)
```

Se ao menos um for selecionado, o template de `package.json.hbs` inclui:
```json
"@refarm.dev/deps": "workspace:*"
```
nos devDependencies gerados.

As dependências individuais (ex: `ws`) ainda são declaradas pelo próprio
pacote via `catalog:` — o `@refarm.dev/deps` é o contrato de ecossistema,
não o resolvedor.

## Arquivos a modificar

- `turbo/generators/config.ts` — novo prompt `type: "checkbox"` para primitivos
- `turbo/generators/templates/*/package.json.hbs` — condicional `{{#if usesDeps}}`
- `turbo/generators/templates/contract-v1/package.json.hbs` — idem

## Constraint

O prompt deve ser **opcional com skip por padrão** — a maioria dos pacotes
`buildable` e `contract-v1` não usa primitivos de runtime do ecossistema.
Não deve bloquear o fluxo comum de scaffold.
