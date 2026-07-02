# Capability Contracts

Contratos versionados para capabilities do micro-kernel Refarm.

## Estrutura

Cada capability é um pacote independente com:

1. **Types**: Interfaces TypeScript do provider
2. **Conformance runner**: Função que valida implementações
3. **Reference test**: Implementação em memória para demonstração
4. **Telemetry events**: Tipos de eventos mínimos obrigatórios

## Capabilities Disponíveis

### `storage:v1`
**Pacote**: `@refarm.dev/storage-contract-v1`  
**Provider**: `StorageProvider`  
**Operações**: `get`, `put`, `delete`, `query`

Backend de persistência (OPFS, IndexedDB, SQLite, etc.)

### `sync:v1`
**Pacote**: `@refarm.dev/sync-contract-v1`  
**Provider**: `SyncProvider`  
**Operações**: `connect`, `push`, `pull`, `disconnect`

Sincronização distribuída (CRDT, OT, WebSocket, WebRTC, etc.)

### `identity:v1`
**Pacote**: `@refarm.dev/identity-contract-v1`  
**Provider**: `IdentityProvider`  
**Operações**: `create`, `sign`, `verify`, `get`

Gerenciamento de identidade (Nostr, DID, OAuth, passkeys, etc.)

**Adapter real inicial**: `@refarm.dev/identity-heartwood` fornece um
provider `identity:v1` com assinaturas Ed25519 reais via `@refarm.dev/heartwood`.
`@refarm.dev/identity-nostr` continua sendo o adapter Nostr; ele não é usado
como atalho para assinatura real enquanto sua criptografia Nostr estiver
placeholder.

### `credentials:v1`
**Pacote**: `@refarm.dev/credentials-contract-v1`
**Provider**: `CredentialsProvider`
**Operações**: `issue`, `verify`, `present`, `store`, `list`, `remove`

Contrato de Verifiable Credentials e wallet de dados. Ele compõe
`identity:v1` para provas issuer/holder e `storage:v1` para persistência,
sem implementar crypto, storage backend, trust registry, schema de domínio ou
UX de wallet.

### `enrichment:v1`
**Pacote**: `@refarm.dev/enrichment-contract-v1`
**Provider**: `EnrichmentProvider`
**Operações**: `describe`, `select`, `enrich`

Enriquecimento determinístico de records/notas por providers externos. O
provider retorna mudanças com proveniência e diagnósticos; consumidores decidem
se e como persistir. O pacote está implementado, consumer-proven no `vault-seed`
e selecionado para `vault-seed-ready`; publicação pública ainda passa pela
release lane.

### `records:v1`
**Pacote**: `@refarm.dev/records-contract-v1`
**Provider**: `RecordsProvider`
**Operações**: `validate`, `upcast`

Envelope neutro para records de conhecimento/conteúdo, relações, seções,
anexos, source refs, hash e estado de revisão. Vocabulário fica em dados
JSON-LD/open strings; storage, sync, renderer e workflow editorial ficam fora
do contrato.

## Source Adapters

### `source:v1`
**Contrato**: `@refarm.dev/source-contract-v1`
**Adapters**: `@refarm.dev/source-git`, `@refarm.dev/source-local`,
`@refarm.dev/source-web`

Materialização de fontes em snapshots estáveis. `source-web` não adiciona
`kind: "web"` ao contrato; ele materializa captura web autenticada como snapshot
local redigido e replayable, com sessão/cache/pacing/redaction em provenance do
pacote.

## Uso

### Para Consumidores (Kernel/Apps)

```typescript
import { createStorageV1Provider } from "@refarm.dev/storage-sqlite";
import type { StorageProvider } from "@refarm.dev/storage-contract-v1";

const storage: StorageProvider = createStorageV1Provider();
await storage.put({ id: "1", type: "note", payload: "..." });
```

### Para Implementadores (Terceiros)

```typescript
import { 
  runStorageV1Conformance,
  type StorageProvider 
} from "@refarm.dev/storage-contract-v1";

class MyStorageProvider implements StorageProvider {
  readonly pluginId = "@vendor/my-storage";
  readonly capability = "storage:v1";
  
  async get(id: string) { /* ... */ }
  async put(record: StorageRecord) { /* ... */ }
  async delete(id: string) { /* ... */ }
  async query(query: StorageQuery) { /* ... */ }
}

// Validar conformance
const result = await runStorageV1Conformance(new MyStorageProvider());
if (!result.pass) {
  console.error("Falhas:", result.failures);
}
```

## Conformance em CI

Execute todos os testes de conformance:

```bash
npm run test:capabilities
pnpm -C packages/identity-heartwood run test:conformance
pnpm -C packages/credentials-contract-v1 run test:conformance
```

Pipelines CI bloqueiam providers incompatíveis automaticamente.

## Versionamento

Capabilities usam versionamento semântico no nome:

- `storage:v1`, `storage:v2` (breaking changes)
- Plugins declaram qual versão suportam no manifest
- Kernel valida compatibilidade no onboarding

## Observabilidade

Todos os providers DEVEM emitir eventos de telemetria:

```typescript
interface TelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: string;
  operation: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
}
```

Hooks obrigatórios (verificados no manifest):
- `onLoad`
- `onInit`
- `onRequest`
- `onError`
- `onTeardown`

## Criando Nova Capability

1. Copiar estrutura de um contrato existente
2. Definir tipos em `src/types.ts`
3. Implementar `runXxxV1Conformance()` em `src/conformance.ts`
4. Criar teste de referência em `src/conformance.test.ts`
5. Adicionar ao comando `test:capabilities` no root

## Referências

- [ADR-017: Studio Micro-Kernel and Plugin Boundary](../../specs/ADRs/ADR-017-studio-micro-kernel-and-plugin-boundary.md)
- [ADR-018: Capability Contracts and Observability Gates](../../specs/ADRs/ADR-018-capability-contracts-and-observability-gates.md)
- [Plugin Manifest Schema](../plugin-manifest/)
