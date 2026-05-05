# Barn: OPFS Storage Layout & Naming Convention

Layout canônico para cache de plugins WASM usado pelo contrato compartilhado de instalação (`@refarm.dev/plugin-manifest/installWasmArtifact`) com implementação OPFS no `@refarm.dev/tractor`.

## Estrutura de Diretórios

Diretório raiz no OPFS: `/refarm/barn/`

```text
/refarm/barn/
├── implements/
│   └── <cache-key>.wasm     # Binário WASM verificado
└── metadata/
    └── <cache-key>.json     # Metadados do artefato (integrity/url/hash/cachedAt)
```

## Convenção de nomes

- **cache-key**: derivado de `pluginId` normalizado para `[a-z0-9_-]` (demais chars viram `_`, depois lowercase).
- **WASM path**: `/refarm/barn/implements/<cache-key>.wasm`
- **Metadata path**: `/refarm/barn/metadata/<cache-key>.json`

## Contrato install/cache/verify

`installWasmArtifact` garante pipeline único:

1. **Check cache**: `cache.get(pluginId)`
2. **Validate cache**: SHA-256 contra `integrity` (`sha256-<base64|hex>`)
3. **Evict on mismatch**: cache inválido é removido
4. **Fetch + verify**: baixa do `wasmUrl` e valida hash
5. **Persist**: `cache.set(pluginId, bytes, metadata)`

Esse contrato é compartilhado por Barn e Tractor, eliminando duplicação de lógica de integridade e instalação.
