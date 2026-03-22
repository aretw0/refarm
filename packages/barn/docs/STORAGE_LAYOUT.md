# Barn: OPFS Storage Layout & Naming Convention

Para garantir a soberania e a performance no acesso aos plugins WASM, o **Barn (O Celeiro)** utiliza o **OPFS (Origin Private File System)**. Este documento define como os arquivos são organizados.

## Estrutura de Diretórios

O Barn opera sob um diretório raiz dedicado no OPFS: `/refarm/barn/`.

```text
/refarm/barn/
├── catalog.json             # Cache local do catálogo (SovereignNodes)
├── implements/              # Binários WASM dos plugins
│   ├── <plugin-id>.wasm     # Binário verificado
│   └── <plugin-id>.sig      # (Opcional) Assinatura do autor
└── metadata/                # Manifestos e ícones cacheados
    └── <plugin-id>.json     # Cópia do PluginManifest
```

## Convenção de Nomes

1.  **Plugin ID**: Deve seguir o formato URN `urn:refarm:plugin:<slug>`, onde `<slug>` é um identificador único em minúsculas (ex: `matrix-bridge`).
2.  **Binários**: Armazenados com a extensão `.wasm`. O nome do arquivo é o `<slug>` do plugin.
3.  **Integridade**: O Barn deve validar o SHA-256 do arquivo contra o campo `sha256Integrity` no catálogo antes de qualquer execução.

## Fluxo de Cache

1.  **Check**: Verificar se `<plugin-id>.wasm` existe no OPFS.
2.  **Validate**: Se existir, calcular SHA-256 e comparar.
3.  **Fetch**: Se não existir ou falhar na validação, baixar da `installUrl`.
4.  **Persist**: Salvar no OPFS após validação bem-sucedida.
