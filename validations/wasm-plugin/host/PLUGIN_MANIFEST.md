# Plugin Manifest

Este arquivo define metadados obrigatórios para onboarding do plugin no micro-kernel.

## Campos

- **id**: Identificador único scoped (@vendor/plugin-name)
- **name**: Nome human-readable
- **version**: SemVer
- **entry**: Ponto de entrada relativo (ESM .js)
- **capabilities.provides**: Capabilities que este plugin implementa
- **capabilities.requires**: Capabilities de kernel/outros plugins necessárias
- **permissions**: Lista de permissões solicitadas
- **observability.hooks**: Hooks de telemetria obrigatórios (onLoad, onInit, onRequest, onError, onTeardown)

## Validação

Plugin Inspector valida este manifesto com `@refarm/plugin-manifest`.

```bash
npm run validate:manifest
```

## Conformance

Cada capability declarada em `provides` deve passar em conformance test específico (ex: `storage:v1`, `sync:v1`).
