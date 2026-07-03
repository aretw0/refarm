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
  "refarm:status": "installed", // ou "pending", "error", "available", "development"
  "refarm:installedAt": "2026-03-21T12:05:00Z",
  "refarm:sourceType": "remote", // ou "local-dev", "synthetic", "graph-synced"
  "refarm:accessControl": {
    "refarm:allowedBranches": ["dev", "experimental"],
    "refarm:deniedBranches": ["main"]
  },
  "refarm:manifest": { /* Conteúdo completo do PluginManifest */ }
}
```

### Propriedades Expandidas:

*   `@context`: `https://schema.org/`
*   `@type`: `SoftwareApplication` (tipo base para softwares)
*   `@id`: URN único para o plugin (ex: `urn:refarm:plugin:my-awesome-plugin`)
*   `name`: Nome legível do plugin.
*   `description`: Descrição curta do que o plugin faz.
*   `softwareVersion`: Versão semântica do plugin.
*   `applicationCategory`: Sempre "Plugin" para identificação.
*   `installUrl`: URL de instalação. Pode ser `https://`, `file://` (para dev local) ou `urn:refarm:blob:` (para plugins no grafo).
*   `sha256Integrity`: Hash SHA-256 para verificação. Obrigatório para todos os tipos de fonte.
*   `refarm:status`: Status atual (e.g., `installed`, `development`, `synthetic`).
*   `refarm:sourceType`: Origem do plugin:
    *   `remote`: Baixado de uma URL pública (Registry/Nostr).
    *   `local-dev`: Link para um projeto local em desenvolvimento (Terminal/Devcontainer).
    *   `synthetic`: Gerado dinamicamente via UI (Low-Code/No-Code).
    *   `graph-synced`: Plugin privado do usuário sincronizado via CRDT entre dispositivos.
*   `refarm:accessControl`: **Controle Fino de Grafo**. Define em quais branches do Sovereign Graph o plugin pode ler/escrever. O padrão para novos plugins deve ser restrito (ex: apenas branch `experimental`).
*   `refarm:manifest`: Objeto contendo o `PluginManifest` completo.

## `refarm:ConfigOverride` (irmão do `PluginCatalogEntry`)

Enquanto o `PluginCatalogEntry` é a **observação** do que foi instalado (espelho
read-only do manifesto — §0, nunca editar), o `ConfigOverride` é o **modelo do
usuário**: a config que a pessoa completou/ajustou *depois*, persistida à parte
para **nunca tocar o manifesto/`SKILL.md` original** (que pode nem ser nosso).
Proveniências diferentes → registros/arquivos diferentes. Persistido via
`@refarm.dev/storage-fs` em `<scope>/.refarm/config/overrides.json` como um
`StorageRecord` de `type: "config-override"`.

```json
{
  "@context": "https://schema.org/",
  "@type": "refarm:ConfigOverride",
  "@id": "urn:refarm:config-override:<plugin-id>",
  "refarm:targetPlugin": "urn:refarm:plugin:<plugin-id>",
  "refarm:scope": "workspace", // ou "user"
  "refarm:capabilities": ["network:fetch"], // additivo sobre o manifesto
  "refarm:disabled": false,                  // desliga a extensão sem desinstalar
  "refarm:exclude": ["surface-id-a"],        // surfaces do plugin a ignorar
  "refarm:updatedAt": "2026-07-03T12:00:00Z"
}
```

### Propriedades

*   `refarm:targetPlugin`: `@id` do `PluginCatalogEntry` que este override ajusta
    (cross-reference por `pluginId`; **não** duplica os campos do install record).
*   `refarm:scope`: `user` (`~/.refarm`) ou `workspace` (`./.refarm`). A
    precedência é **workspace vence**, e ambos sobrepõem o manifesto (ver
    [ADR-082](../../../specs/ADRs/ADR-082-storage-provider-bootstrap-boundary.md)
    e `STORAGE_LAYOUT.md`).
*   `refarm:capabilities`: capabilities que o usuário declarou para amadurecer uma
    extensão *permissiva* → *complete*, **additivas** ao manifesto.
*   `refarm:disabled` / `refarm:exclude`: resolução explícita de conflito entre
    extensões (dois plugins declarando o mesmo `layer:kind:id`) — o host explica o
    conflito (estilo pi.dev) e a resolução é por precedência → disable explícito,
    **nunca** auto-rename (ids são identidade de capability grants).

O fold `manifesto ⊕ override(user) ⊕ override(workspace)` é feito por um helper
puro `composeEffectiveManifest(manifest, overrides[])` (em `plugin-manifest`,
sem fs); o Barn fornece a lista ordenada de overrides lida do ledger.

## Relação com o `refarm:plugin/types.wit`

O `plugin-entry` definido no `refarm-barn.wit` será uma representação mais concisa e tipada dos dados essenciais do `refarm:PluginCatalogEntry` para uso interno do Tractor e dos plugins. O `refarm:PluginCatalogEntry` em JSON-LD é a representação canônica no Sovereign Graph.

## Próximos Passos

Com o WIT e o esquema JSON-LD definidos, o próximo passo é a fase BDD, onde escreveremos os testes de integração para o `apps/dev/plugins.astro` que simularão a interação com o Barn para instalar e listar plugins. Esses testes falharão inicialmente, guiando a implementação do plugin Barn e da UI do Galpão.
