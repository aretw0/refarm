# Análise: Studio Totalmente Plugável

## 🎯 Visão
Studio como micro-kernel onde até funcionalidades core (OPFS, SQLite, CRDT, Nostr) são plugins.

## 🏗️ Arquitetura Micro-Kernel

### Núcleo Irredutível (Studio Core)
**Responsabilidades mínimas** que NÃO podem ser plugins:

```typescript
// apps/studio/src/core/kernel.ts
interface KernelMinimal {
  // 1. Plugin Loader
  loadPlugin(url: string): Promise<PluginInstance>;
  unloadPlugin(id: string): void;
  
  // 2. Capability System
  registerCapability(cap: string, plugin: string): void;
  checkPermission(plugin: string, cap: string): boolean;
  
  // 3. Message Bus (IPC)
  subscribe(event: string, handler: Handler): Unsubscribe;
  publish(event: string, payload: any): void;
  
  // 4. UI Host (slots)
  registerSlot(id: string, element: HTMLElement): void;
  render(plugin: string, slot: string, vdom: VNode): void;
}
```

**Tamanho estimado**: ~10-20 KB minified
**Tecnologias**: Vite + lightweight virtual DOM (ex: preact)

### Camada de Plugins (Tudo o Resto)

#### Core Plugins (sempre carregados)
```typescript
const CORE_PLUGINS = [
  '@refarm/plugin-storage',     // OPFS + SQLite
  '@refarm/plugin-sync',        // CRDT sync
  '@refarm/plugin-identity',    // Nostr identity
  '@refarm/plugin-ui',          // Design system components
  '@refarm/plugin-api',         // Kernel API helpers
] as const;
```

#### Optional Plugins (carregados sob demanda)
```typescript
const OPTIONAL_PLUGINS = [
  '@refarm/plugin-csv-import',
  '@refarm/plugin-json-export',
  '@refarm/plugin-graph-viz',
  '@community/plugin-analytics',
] as const;
```

## 🔄 Fluxo de Bootstrap

### Problema: Como carregar plugin-loader se ele é um plugin?

**Solução 1: Plugin Loader no Core** ✅
```typescript
// Studio Core tem loader embutido
// Loader é parte do kernel, não é um plugin
┌────────────────┐
│  Studio Core   │
│  [Plugin Loader│ ← hardcoded no core
│   Capability   │
│   Message Bus  │
│   UI Shell]    │
└────────────────┘
       ↓ carrega
   [Plugins]
```

**Solução 2: Two-Stage Bootstrap** 🤔
```typescript
// Stage 1: Minimal loader (ESM import)
import { loadWasmPlugin } from './bootstrap-loader.js';

// Stage 2: Loader plugin substitui o bootstrap
const advancedLoader = await loadWasmPlugin('@refarm/plugin-loader-advanced');
kernel.replaceLoader(advancedLoader);
```

## 🎭 Exemplos de Composição

### Distribuição 1: Minimal (Local-first puro)
```typescript
const MinimalStudio = {
  core: ['plugin-loader', 'capability', 'message-bus', 'ui-shell'],
  plugins: [
    '@refarm/storage-opfs',    // Persistência local
    '@refarm/ui-primitives',   // Componentes básicos
  ],
  size: '~80 KB total',
  capabilities: ['offline-only', 'no-sync', 'no-auth'],
};
```

### Distribuição 2: Full (Local + Sync + Identity)
```typescript
const FullStudio = {
  ...MinimalStudio,
  plugins: [
    ...MinimalStudio.plugins,
    '@refarm/sync-crdt',       // Sincronização
    '@refarm/identity-nostr',  // Identidade descentralizada
    '@refarm/plugin-csv',      // Importação CSV
  ],
  size: '~600 KB total',
  capabilities: ['offline', 'sync', 'multi-device', 'auth'],
};
```

### Distribuição 3: Enterprise (Full + Compliance)
```typescript
const EnterpriseStudio = {
  ...FullStudio,
  plugins: [
    ...FullStudio.plugins,
    '@acme/audit-logger',      // Logs de auditoria
    '@acme/auth-saml',         // SAML SSO
    '@acme/storage-s3',        // Backup em S3
    '@acme/compliance-gdpr',   // GDPR compliance
  ],
  size: '~1.2 MB total',
  capabilities: ['enterprise-auth', 'audit', 'compliance', 'cloud-backup'],
};
```

## 🔒 Sistema de Capabilities

### Plugin Manifest
```typescript
// @refarm/plugin-storage/manifest.json
{
  "id": "@refarm/storage-opfs",
  "version": "1.0.0",
  "capabilities": {
    "provides": [
      "storage:read",
      "storage:write",
      "storage:query"
    ],
    "requires": [
      "browser:opfs",
      "wasm:sqlite"
    ]
  },
  "exports": {
    "kernelStorage": "./dist/storage.wasm"
  }
}
```

### Dependency Resolution
```typescript
// Studio Core resolve dependências
async function loadPluginWithDeps(pluginId: string) {
  const manifest = await fetchManifest(pluginId);
  
  // 1. Verificar capabilities do browser
  for (const cap of manifest.capabilities.requires) {
    if (!browserSupports(cap)) {
      throw new Error(`Browser missing: ${cap}`);
    }
  }
  
  // 2. Carregar dependências primeiro
  for (const dep of manifest.dependencies) {
    if (!kernel.isLoaded(dep)) {
      await loadPluginWithDeps(dep);
    }
  }
  
  // 3. Carregar plugin
  const instance = await kernel.loadPlugin(manifest.exports.kernelStorage);
  kernel.register(pluginId, instance);
}
```

## 🚧 Desafios Arquiteturais

### 1. Performance Initialization
**Problema**: Carregar N plugins = N network requests + N WASM compilations
**Solução**: 
- Bundle core plugins em um único .wasm
- HTTP/2 Push para plugins críticos
- Lazy loading para plugins opcionais

### 2. Plugin Interdependencies
**Problema**: Plugin A depende de Plugin B que depende de Plugin C
**Solução**:
- Dependency graph resolution (topological sort)
- Cycle detection
- Version constraints (semver)

### 3. Hot Reload de Plugins Core
**Problema**: Como trocar plugin-storage sem perder dados?
**Solução**:
- State migration API
- Versioned schemas
- Graceful degradation

### 4. Type Safety Cross-Plugin
**Problema**: TypeScript não conhece APIs de plugins em runtime
**Solução**:
```typescript
// Shared type definitions
import type { StorageAPI } from '@refarm/sdk/storage';

const storage = kernel.getPlugin<StorageAPI>('@refarm/storage-opfs');
//    ^? StorageAPI (typed!)
```

## 💡 Implementações Alternativas (3rd Party)

### Storage Layer
```typescript
// Cliente pode escolher backend
'@refarm/storage-opfs'       // SQLite em OPFS (default)
'@acme/storage-indexeddb'    // IndexedDB puro
'@acme/storage-postgres'     // PostgreSQL via pg_wasm
'@acme/storage-duckdb'       // DuckDB WASM
```

### Sync Layer
```typescript
'@refarm/sync-crdt'          // CRDT via Automerge/Yjs
'@acme/sync-ot'              // Operational Transform
'@acme/sync-websocket'       // WebSocket simples
'@acme/sync-webrtc'          // P2P via WebRTC
```

### Identity Layer
```typescript
'@refarm/identity-nostr'     // Nostr keys
'@acme/identity-oauth'       // OAuth 2.0
'@acme/identity-did'         // DID Web5
'@acme/identity-passkey'     // WebAuthn passkeys
```

## 📊 Trade-offs: Plugável vs Monolítico

| Aspecto | Plugável | Monolítico |
|---------|----------|------------|
| **Bundle Size** | ✅ Menor (só o necessário) | ❌ Tudo sempre |
| **Load Time** | ⚠️ N requests | ✅ 1 request |
| **Composição** | ✅✅ Máxima | ❌ Fixa |
| **Manutenção** | ⚠️ Complexa (versionamento) | ✅ Simples |
| **Type Safety** | ⚠️ Runtime types | ✅ Compile time |
| **Testing** | ✅ Mockable | ⚠️ Acoplado |
| **Terceiros** | ✅✅ Ecossistema | ❌ Impossível |

## 🎯 Recomendação

### Fase 1: Hybrid Approach (Melhor dos 2 mundos)

```typescript
// Studio Core = Kernel + Core Plugins hardcoded
const StudioCore = {
  kernel: {
    pluginLoader: embedido,
    capabilities: embedido,
    messageBus: embedido,
    uiShell: embedido,
  },
  corePlugins: {
    // Compilados juntos no bundle principal
    storage: storage_opfs,
    sync: sync_crdt,
    identity: identity_nostr,
  },
  optionalPlugins: {
    // Carregados sob demanda
    csvImport: lazy(() => import('@refarm/csv')),
    jsonExport: lazy(() => import('@refarm/json')),
  },
};
```

**Vantagens**:
- ✅ Core plugins otimizados (zero latency)
- ✅ Optional plugins plugáveis (composição)
- ✅ Sem bootstrap complexity
- ✅ Type safety para core APIs

### Fase 2: Full Micro-Kernel (Quando escala)

Migrar para micro-kernel puro quando:
- [ ] Ecossistema de 3rd party plugins consolidado
- [ ] Necessidade de múltiplas "distribuições"
- [ ] Time dedicado para plugin tooling/SDK
- [ ] Justificativa para complexidade adicional

## 🔗 Precedentes na Indústria

### ✅ Sucessos
- **VS Code**: ~50 KB core + 10,000+ extensions
- **Figma**: Browser engine + community plugins
- **Obsidian**: Markdown engine + plugins para tudo

### ⚠️ Fracassos
- **Eclipse RCP**: Over-engineered, difícil desenvolver
- **NetBeans Platform**: Curva de aprendizado brutal
- **OSGI**: Complexidade de versionamento matou adoção

## 📝 Próximos Passos

### 1. Definir "Core Irredutível"
- [ ] Escrever spec do `KernelMinimal`
- [ ] Definir Plugin Manifest schema
- [ ] Projetar Capability System

### 2. Prototipar Plugin Loader
- [ ] Carregar WASM via jco
- [ ] Sandbox de segurança
- [ ] State isolation entre plugins

### 3. Migrar Packages Atuais
- [ ] `packages/storage-sqlite` → `plugin-storage`
- [ ] `packages/sync-crdt` → `plugin-sync`
- [ ] `packages/identity-nostr` → `plugin-identity`

### 4. Criar SDK de Plugins
- [ ] Templates (cookiecutter)
- [ ] Type definitions (d.ts)
- [ ] Testing utilities
- [ ] Documentation site

## 🤔 Questões em Aberto

1. **Hot reload**: Plugins podem ser trocados em runtime sem perder estado?
2. **Versioning**: Como garantir compatibilidade entre plugins?
3. **Security**: Sandbox suficiente para plugins 3rd party untrusted?
4. **Performance**: Overhead de message bus vs direct calls?
5. **Distribution**: Registry centralizado ou NPM direto?
