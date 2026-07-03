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

## Análogo Node: ledger `.refarm/` (host bootstrap)

No browser, o layout acima vive em OPFS. No Node, o análogo durável é um ledger
`.refarm/` persistido pelo `@refarm.dev/storage-fs` — o **backend de bootstrap**
que o host garante (não é plugin; ver [ADR-082](../../../specs/ADRs/ADR-082-storage-provider-bootstrap-boundary.md)).
Dois eixos independentes, escritos atomicamente (tmp+rename, dir `0700` / arquivo
`0600`):

```text
<scope>/.refarm/
├── barn/
│   ├── implements/          # bytes WASM verificados (análogo Node do OPFS)
│   ├── metadata/            # metadados do artefato
│   └── ledger.json          # install records (StorageRecord type=install-record)
└── config/
    └── overrides.json       # config-override do usuário/workspace (type=config-override)
```

- **`<scope>`**: `~/.refarm` (usuário, vale em todos os projetos) ou `./.refarm`
  (workspace, checkável). A precedência é **workspace vence sobre usuário**, e
  ambos sobrepõem o manifesto original (nunca o editam). A ordem de aplicação é
  resolvida por `orderedScopeStorePaths` em `storage-fs/scope.ts`.
- **Records vs bytes são irmãos** (ADR-082): `ledger.json`/`overrides.json` são
  `StorageRecord`s JSON via `StorageProvider`; os bytes WASM em `implements/`
  seguem pelo `PluginBinaryCacheAdapter` (`ArrayBuffer`) — mesmo eixo de backend,
  contratos de dado diferentes.
- **install record ≠ config-override**: o install record é uma *observação*
  (§0 — nunca editar) espelhando o manifesto; o override é o *modelo do usuário*.
  Proveniências diferentes → arquivos/`type`s diferentes.

> A auditoria `INSTALL_FLOW_AUDIT_20260423.md` (T-PLUGIN-01) apontou que a
> persistência Node do Barn era process-local (in-memory, sem catálogo durável).
> O `storage-fs` fecha esse gap; falta o Barn **injetar** o provider (pendência
> registrada no ADR-082).
