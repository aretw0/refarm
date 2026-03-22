# Barn: Esquema JSON-LD para Catálogo de Plugins

Este documento define o esquema JSON-LD para representar os plugins gerenciados pelo **Barn (O Celeiro)**. Cada plugin será um `SovereignNode` no grafo, permitindo que o Barn catalogue e o Surveyor visualize esses ativos.

## `refarm:PluginCatalogEntry`

Representa uma entrada no catálogo de plugins do Barn. É um tipo de `SovereignNode` que armazena metadados essenciais sobre um plugin instalado ou disponível.

```json
{
  "@context": "https://schema.org/",
  "@type": "SoftwareApplication",
  "@id": "urn:refarm:plugin:<plugin-id>",
  "name": "Nome do Plugin",
  "description": "Descrição breve do plugin.",
  "softwareVersion": "0.1.0",
  "applicationCategory": "Plugin",
  "installUrl": "https://example.com/plugin.wasm",
  "sha256Integrity": "sha256-<base64-encoded-hash>",
  "datePublished": "2026-03-21T12:00:00Z",
  "refarm:status": "installed", // ou "pending", "error", "available"
  "refarm:installedAt": "2026-03-21T12:05:00Z",
  "refarm:manifest": { /* Conteúdo completo do PluginManifest */ }
}
```

### Propriedades:

*   `@context`: `https://schema.org/`
*   `@type`: `SoftwareApplication` (tipo base para softwares)
*   `@id`: URN único para o plugin (ex: `urn:refarm:plugin:my-awesome-plugin`)
*   `name`: Nome legível do plugin.
*   `description`: Descrição curta do que o plugin faz.
*   `softwareVersion`: Versão semântica do plugin.
*   `applicationCategory`: Sempre "Plugin" para identificação.
*   `installUrl`: URL de onde o binário WASM do plugin pode ser baixado.
*   `sha256Integrity`: Hash SHA-256 para verificação de integridade do binário WASM. Essencial para segurança.
*   `datePublished`: Data de publicação/disponibilização do plugin.
*   `refarm:status`: Status atual do plugin no Barn (e.g., `installed`, `pending`, `error`, `available`).
*   `refarm:installedAt`: Timestamp da instalação do plugin (se aplicável).
*   `refarm:manifest`: Objeto contendo o `PluginManifest` completo, conforme definido em `packages/plugin-manifest/src/types.ts`.

## Relação com o `refarm:plugin/types.wit`

O `plugin-entry` definido no `refarm-barn.wit` será uma representação mais concisa e tipada dos dados essenciais do `refarm:PluginCatalogEntry` para uso interno do Tractor e dos plugins. O `refarm:PluginCatalogEntry` em JSON-LD é a representação canônica no Sovereign Graph.

## Próximos Passos

Com o WIT e o esquema JSON-LD definidos, o próximo passo é a fase BDD, onde escreveremos os testes de integração para o `apps/dev/plugins.astro` que simularão a interação com o Barn para instalar e listar plugins. Esses testes falharão inicialmente, guiando a implementação do plugin Barn e da UI do Galpão.
